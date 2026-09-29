// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Dgram = require('node:dgram');

const Success = 0x504521a8;

const Result = Object.freeze({
    Success,
    NoOurMachineId: 1568882860,
    OurMachineNotInList: -1123854125 >>> 0,
    LeaderNotInList: 1637878230,
    NoTrafficAsLeader: 2259940000,
    WaitingForEcho: 883881395,
    LeaderUnresponsive: 3021216802,
    EchoFromOtherMachine: 1503004174,
    StaleSequence: -376324268 >>> 0,
    SequenceNotNewer: -1714455578 >>> 0,
    UnknownFrame: 499424121,
    ShortFrame: 1312362692,
    RemoveUnknownMachine: 1264485671,
    RemoveOurselves: 581507056,
    RelayNotConnected: 854364815,
});

const RemoveReason = Object.freeze({
    Unresponsive: 3240241540,
    LeaderLostAfterEcho: 1549515993,
    LeavePacket: 0x4149111c,
});

const FrameType = Object.freeze({
    Leave: 0x4149111c,
    Echo: 0x41bf6bc3,
    Leader: 0x5c85bd15,
    Connectivity: 0x6e225397,
});

const FrameLength = Object.freeze({ Leave: 16, Long: 24 });

const Timing = Object.freeze({
    HeartbeatSeconds: 1.0,
    MissingHeartbeatSeconds: 10.0,
    EchoRetrySeconds: 1.0,
    MaxEchoRetries: 10,
    EchoesBeforeRemovingLeader: 10,
    ResetMachineListOnAllNewMatchState: false,
    ConnectivitySeconds: 3.0,
    RelayRetries: 10,
    RelayPollSeconds: 1.0,
});

const U64 = (Value) => BigInt.asUintN(64, BigInt(Value));

function EncodeFrame(Type, SubjectMachineId, Sequence = null) {
    const Leave = Type === FrameType.Leave;
    const Frame = Buffer.alloc(Leave ? FrameLength.Leave : FrameLength.Long);
    Frame.writeUInt32LE(Frame.length, 0);
    Frame.writeUInt32LE(Type >>> 0, 4);
    Frame.writeBigUInt64LE(U64(SubjectMachineId), 8);
    if (!Leave) Frame.writeBigUInt64BE(U64(Sequence ?? 0n), 16);
    return Frame;
}

function DecodeFrames(Payload) {
    const Frames = [];
    if (!Buffer.isBuffer(Payload)) return Frames;
    for (let At = 0; Payload.length - At >= 16;) {
        const Length = Payload.readUInt32LE(At);
        if (Length < 16 || Length > Payload.length - At) break;
        const Type = Payload.readUInt32LE(At + 4);
        Frames.push({
            Length: Length,
            Type: Type,
            SubjectMachineId: Payload.readBigUInt64LE(At + 8),
            Sequence: Length >= 24 ? Payload.readBigUInt64BE(At + 16) : null,
            Bytes: Payload.subarray(At, At + Length),
        });
        At += Length;
    }
    return Frames;
}

function LeaderOf(MachineIds) {
    let Leader = null;
    for (const Raw of MachineIds) {
        const Id = U64(Raw);
        if (Leader === null || Id < Leader) Leader = Id;
    }
    return Leader === null ? 0n : Leader;
}

class Match {
    constructor({ TicketId, Sequence, OurMachineId, RelayToken, RelayId, RelayHost, RelayPort, MachineIds }) {
        this.TicketId = U64(TicketId);
        this.Sequence = U64(Sequence);
        this.OurMachineId = U64(OurMachineId);
        this.RelayToken = Buffer.from(RelayToken || []);
        this.RelayId = Number(RelayId);
        this.RelayHost = RelayHost;
        this.RelayPort = Number(RelayPort);
        this.Machines = (MachineIds || []).map(U64);
        this.LeaderMachineId = LeaderOf(this.Machines);
        this.FirstError = 0;
        this.NewestSequenceSeen = 0n;
        this.HighestUnknownMachine = 0n;
        this.RemoveRequests = [];
    }

    RecordError(Code) {
        if (!this.FirstError) this.FirstError = Code >>> 0;
        return this.FirstError;
    }

    NoteNewerSequence(Sequence) {
        if (Sequence <= this.NewestSequenceSeen) return Result.SequenceNotNewer;
        this.NewestSequenceSeen = Sequence;
        return Success;
    }

    NoteUnknownMachine(MachineId) {
        if (MachineId <= this.HighestUnknownMachine) return Result.SequenceNotNewer;
        this.HighestUnknownMachine = MachineId;
        return Success;
    }

    SendRemoveRequest(MachineId, Reason) {
        const Id = U64(MachineId);
        if (!this.Machines.length) return Success;
        if (Id === this.OurMachineId) return Result.RemoveOurselves;
        const Index = this.Machines.indexOf(Id);
        if (Index < 0) return Result.RemoveUnknownMachine;
        this.Machines.splice(Index, 1);
        this.RemoveRequests.push({ MachineId: Id, Reason: Reason >>> 0 });
        this.LeaderMachineId = LeaderOf(this.Machines);
        return Success;
    }
}

class Connectivity {
    constructor(MatchValue, Transport, TimingData = Timing) {
        this.Match = MatchValue;
        this.Transport = Transport;
        this.Timing = TimingData;
        this.Nodes = new Map();
        this.EchoesReceived = 0;
        this.EchoesSent = 0;
        this.LastPacketAt = 0;
        this.LastEchoSentAt = 0;
        this.LastLeaderBroadcastAt = 0;
        this.NextConnectivityAt = 0;
        this.Fatal = 0;
        this.Received = { Leader: 0, Connectivity: 0, Echo: 0, Leave: 0 };
        this.Sent = { Leader: 0, Connectivity: 0, Echo: 0, Leave: 0 };
    }

    Frame(Type, Subject) {
        return EncodeFrame(Type, Subject, Type === FrameType.Leave ? null : this.Match.Sequence);
    }

    SessionFatal(Code) {
        if (!this.Fatal) this.Fatal = Code >>> 0;
        return Code >>> 0;
    }

    NewMatchState(MachineIds, Now) {
        this.EchoesReceived = 0;
        this.LastPacketAt = Now;
        const Ids = MachineIds.map(U64);
        const Same =
            !this.Timing.ResetMachineListOnAllNewMatchState &&
            Ids.length === this.Nodes.size &&
            Ids.every((Id) => this.Nodes.has(Id));
        if (!Same) this.Nodes.clear();
        for (const Id of Ids) this.Nodes.set(Id, { LastConnectivity: Now, LastPacket: Now });
        return Success;
    }

    Update(Now) {
        const Me = this.Match.OurMachineId;
        const Leader = this.Match.LeaderMachineId;
        if (!Me) return Result.NoOurMachineId;
        if (!this.Nodes.has(Me)) return Result.OurMachineNotInList;
        return Me === Leader ? this.UpdateAsLeader(Me, Now) : this.UpdateAsClient(Me, Leader, Now);
    }

    UpdateAsLeader(Me, Now) {
        if (Now - this.LastPacketAt >= this.Timing.MissingHeartbeatSeconds) {
            return this.SessionFatal(Result.NoTrafficAsLeader);
        }
        const Detected = this.DetectAndRemoveUnresponsiveClients(Me, Now);
        if (Now - this.LastLeaderBroadcastAt < this.Timing.HeartbeatSeconds) return Detected;
        const Sent = this.Transport.Broadcast(this.Frame(FrameType.Leader, Me), false, false);
        if (Sent !== Success) return Sent;
        this.Sent.Leader++;
        this.LastLeaderBroadcastAt = Now;
        return Success;
    }

    UpdateAsClient(Me, Leader, Now) {
        const Node = this.Nodes.get(Leader);
        if (!Node) {
            const Recorded = this.Match.RecordError(Result.LeaderNotInList);
            return Recorded === Success ? Result.LeaderNotInList : Recorded;
        }
        if (Now >= this.NextConnectivityAt) {
            this.NextConnectivityAt = Now + this.Timing.ConnectivitySeconds;
            if (this.Transport.SendToList([Leader], this.Frame(FrameType.Connectivity, Me), false) === Success) {
                this.Sent.Connectivity++;
            }
        }
        if (Now - Node.LastConnectivity <= this.Timing.MissingHeartbeatSeconds) return Success;
        if (this.EchoesSent < this.Timing.MaxEchoRetries) {
            if (Now - this.LastEchoSentAt >= this.Timing.EchoRetrySeconds) {
                const Sent = this.Transport.SendToList([Me], this.Frame(FrameType.Echo, Me), true);
                if (Sent !== Success) return Sent;
                this.Sent.Echo++;
                this.EchoesSent++;
                this.LastEchoSentAt = Now;
            }
            return Result.WaitingForEcho;
        }
        return this.SessionFatal(Result.LeaderUnresponsive);
    }

    DetectAndRemoveUnresponsiveClients(Me, Now) {
        let Outcome = Success;
        for (const [Id, Node] of [...this.Nodes]) {
            if (Id === Me) {
                Node.LastConnectivity = Node.LastPacket = Now;
                continue;
            }
            if (Now - Node.LastConnectivity < this.Timing.MissingHeartbeatSeconds) continue;
            if (Now - Node.LastPacket < this.Timing.MissingHeartbeatSeconds) continue;
            const Removed = this.Match.SendRemoveRequest(Id, RemoveReason.Unresponsive);
            if (Removed === Success) this.Nodes.delete(Id);
            else if (Outcome === Success) Outcome = Removed;
        }
        return Outcome;
    }

    PacketReceived(Frame, Now) {
        this.LastPacketAt = Now;
        this.LastEchoSentAt = 0;
        this.EchoesSent = 0;
        const Subject = this.Nodes.get(Frame.SubjectMachineId);
        if (Subject) Subject.LastPacket = Now;
        switch (Frame.Type >>> 0) {
            case FrameType.Leave:
                this.Received.Leave++;
                return this.LeavePacketReceived(Frame, Now);
            case FrameType.Echo:
                if (Frame.Length < FrameLength.Long) return Result.ShortFrame;
                this.Received.Echo++;
                return this.TestForEchoPacketReceived(Frame, Now);
            case FrameType.Leader:
                if (Frame.Length < FrameLength.Long) return Result.ShortFrame;
                this.Received.Leader++;
                return this.LeaderPacketReceived(Frame, Now);
            case FrameType.Connectivity:
                if (Frame.Length < FrameLength.Long) return Result.ShortFrame;
                this.Received.Connectivity++;
                return this.ConnectivityPacketReceived(Frame, Now);
            default:
                return Result.UnknownFrame;
        }
    }

    LeaderPacketReceived(Frame, Now) {
        const Me = this.Match.OurMachineId;
        const Sender = Frame.SubjectMachineId;
        if (Sender === Me) return Success;
        this.NextConnectivityAt = Now + this.Timing.ConnectivitySeconds;
        this.ConnectivityPacketReceived(Frame, Now);
        const Sent = this.Transport.SendToList([Sender], this.Frame(FrameType.Connectivity, Me), false);
        if (Sent === Success) this.Sent.Connectivity++;
        return Sent;
    }

    ConnectivityPacketReceived(Frame, Now) {
        const Me = this.Match.OurMachineId;
        const Sender = Frame.SubjectMachineId;
        if (Sender === Me) return Success;
        const Node = this.Nodes.get(Sender);
        if (!Node) {
            this.Match.NoteUnknownMachine(Sender);
            return this.AddMachine(Sender, Now);
        }
        Node.LastConnectivity = Now;
        if (Frame.Sequence === this.Match.Sequence) return Success;
        if (Frame.Sequence > this.Match.Sequence) return this.Match.NoteNewerSequence(Frame.Sequence);
        return Result.StaleSequence;
    }

    AddMachine(MachineId, Now) {
        if (this.Nodes.has(MachineId)) return Success;
        if (!this.Nodes.size) this.LastPacketAt = Now;
        this.Nodes.set(MachineId, { LastConnectivity: Now, LastPacket: Now });
        return Success;
    }

    TestForEchoPacketReceived(Frame, Now) {
        const Me = this.Match.OurMachineId;
        if (Frame.SubjectMachineId !== Me) return Result.EchoFromOtherMachine;
        if (++this.EchoesReceived < this.Timing.EchoesBeforeRemovingLeader) return Success;
        const Leader = this.Match.LeaderMachineId;
        if (Me === Leader) return Success;
        const Node = this.Nodes.get(Leader);
        if (!Node) return Success;
        if (Now - Node.LastConnectivity < this.Timing.MissingHeartbeatSeconds) return Success;
        const Removed = this.Match.SendRemoveRequest(Leader, RemoveReason.LeaderLostAfterEcho);
        if (Removed === Success) this.Nodes.delete(Leader);
        for (const Other of this.Nodes.values()) Other.LastConnectivity = Now;
        if (this.Transport.Broadcast(this.Frame(FrameType.Leave, Leader), false, true) === Success) {
            this.Sent.Leave++;
        }
        return Removed;
    }

    LeavePacketReceived(Frame, Now) {
        const Id = Frame.SubjectMachineId;
        this.Nodes.delete(Id);
        for (const Node of this.Nodes.values()) Node.LastConnectivity = Now;
        return this.Match.SendRemoveRequest(Id, RemoveReason.LeavePacket);
    }
}

const RelayType = Object.freeze({ Connect: 0, ConnectReply: 1, Disconnect: 2, Unreliable: 3, Reliable: 4 });
const RelayRouting = Object.freeze({ Delivered: 0, List: 1, Others: 2, All: 3 });

function RelayHeader(Type, Routing, Length, RelayId) {
    return (((Type & 7) << 29) | ((Routing & 3) << 27) | ((Length & 0x7ff) << 16) | (RelayId & 0xffff)) >>> 0;
}

function BuildConnect(RelayId, Token, MachineId) {
    const Packet = Buffer.alloc(28);
    Packet.writeUInt32BE(RelayHeader(RelayType.Connect, RelayRouting.Delivered, 28, RelayId), 0);
    Buffer.from(Token).copy(Packet, 4, 0, 16);
    Packet.writeBigUInt64BE(U64(MachineId), 20);
    return Packet;
}

function ConnectReplyProblem(Packet, RelayId, MachineId) {
    if (Packet.length !== 16) return `connect reply is ${Packet.length} bytes, not 16`;
    const Word = Packet.readUInt32BE(0);
    if ((Word & 0xe0000000) !== 0x20000000) return 'connect reply type is not 1';
    if ((Word & 0xffff) !== (RelayId & 0xffff)) return 'connect reply relay id differs';
    if ((Word & 0x07ff0000) !== 0x00100000) return 'connect reply declares a length other than 16';
    if ((Word & 0x18000000) !== 0) return 'connect reply routing is not delivered';
    if (Packet.readBigUInt64BE(8) !== U64(MachineId)) return 'connect reply names another machine';
    const Status = Packet.readUInt32BE(4);
    if (Status !== 0) return `connect reply status ${Status}`;
    return null;
}

function BuildSendToList(RelayId, MachineIds, Payload, Reliable) {
    const Length = 8 + 8 * MachineIds.length + Payload.length;
    const Packet = Buffer.alloc(Length);
    Packet.writeUInt32BE(
        RelayHeader(Reliable ? RelayType.Reliable : RelayType.Unreliable, RelayRouting.List, Length, RelayId),
        0,
    );
    Packet.writeUInt32BE(MachineIds.length, 4);
    MachineIds.forEach((Id, I) => Packet.writeBigUInt64BE(U64(Id), 8 + 8 * I));
    Payload.copy(Packet, 8 + 8 * MachineIds.length);
    return Packet;
}

function BuildBroadcast(RelayId, Payload, Reliable, All) {
    const Length = 4 + Payload.length;
    const Packet = Buffer.alloc(Length);
    Packet.writeUInt32BE(
        RelayHeader(
            Reliable ? RelayType.Reliable : RelayType.Unreliable,
            All ? RelayRouting.All : RelayRouting.Others,
            Length,
            RelayId,
        ),
        0,
    );
    Payload.copy(Packet, 4);
    return Packet;
}

function BuildDisconnect(RelayId, MachineId) {
    const Packet = Buffer.alloc(12);
    Packet.writeUInt32BE(RelayHeader(RelayType.Disconnect, RelayRouting.Delivered, 12, RelayId), 0);
    Packet.writeBigUInt64BE(U64(MachineId), 4);
    return Packet;
}

function ReceivedPayload(Packet, RelayId) {
    if (Packet.length < 4) throw new Error('relay datagram shorter than its header');
    const Word = Packet.readUInt32BE(0);
    if (((Word >>> 16) & 0x7ff) !== Packet.length) throw new Error('relay datagram length mismatch');
    if ((Word & 0xffff) !== (RelayId & 0xffff)) throw new Error('relay datagram for another relay id');
    if ((Word & 0x18000000) !== 0) throw new Error('relay datagram routing is not delivered');
    const Type = Word >>> 29;
    if (Type === RelayType.Connect) throw new Error('relay sent a connect to a client');
    if (Type === RelayType.ConnectReply || Type === RelayType.Disconnect) return null;
    return Packet.subarray(4);
}

class Peer {
    constructor(MatchValue, { Timing: TimingData = Timing, bind: Bind = '127.0.0.1' } = {}) {
        this.Match = MatchValue;
        this.Bind = Bind;
        this.Socket = null;
        this.Connected = false;
        this.Inbox = [];
        this.Errors = [];
        this.Connectivity = new Connectivity(
            MatchValue,
            {
                SendToList: (Ids, Payload, Reliable) =>
                    this.Send(BuildSendToList(MatchValue.RelayId, Ids, Payload, Reliable)),
                Broadcast: (Payload, Reliable, All) =>
                    this.Send(BuildBroadcast(MatchValue.RelayId, Payload, Reliable, All)),
            },
            TimingData,
        );
    }

    Send(Packet) {
        if (!this.Socket) return Result.RelayNotConnected;
        this.Socket.send(Packet, this.Match.RelayPort, this.Match.RelayHost);
        return Success;
    }

    async Connect({ Retries = Timing.RelayRetries, PollMs = Timing.RelayPollSeconds * 1000 } = {}) {
        this.Socket = Dgram.createSocket('udp4');
        await new Promise((Resolve, Reject) => {
            this.Socket.once('error', Reject);
            this.Socket.bind(0, this.Bind, Resolve);
        });
        const Reply = new Promise((Resolve) => {
            this.Socket.on('message', (Packet) => {
                if (!this.Connected) {
                    const Problem = ConnectReplyProblem(Packet, this.Match.RelayId, this.Match.OurMachineId);
                    if (!Problem) {
                        this.Connected = true;
                        Resolve(true);
                    } else this.Errors.push(Problem);
                    return;
                }
                try {
                    const Payload = ReceivedPayload(Packet, this.Match.RelayId);
                    if (Payload) this.Inbox.push(Payload);
                } catch (Failure) {
                    this.Errors.push(Failure.message);
                }
            });
        });
        const Connect = BuildConnect(this.Match.RelayId, this.Match.RelayToken, this.Match.OurMachineId);
        for (let Attempt = 0; Attempt < Retries && !this.Connected; Attempt++) {
            this.Send(Connect);
            await Promise.race([Reply, new Promise((Resolve) => setTimeout(Resolve, PollMs))]);
        }
        if (!this.Connected) throw new Error(`relay never answered machine 0x${this.Match.OurMachineId.toString(16)}`);
        return true;
    }

    Tick(Now) {
        const Results = [];
        for (const Payload of this.Inbox.splice(0)) {
            for (const Frame of DecodeFrames(Payload)) {
                Results.push({ Frame: Frame, Result: this.Connectivity.PacketReceived(Frame, Now) });
            }
        }
        return { Received: Results, Update: this.Connectivity.Update(Now) };
    }

    Disconnect() {
        if (!this.Socket) return;
        try {
            this.Send(BuildDisconnect(this.Match.RelayId, this.Match.OurMachineId));
        } catch (_) {}
    }

    Close() {
        const Socket = this.Socket;
        this.Socket = null;
        if (Socket)
            try {
                Socket.close();
            } catch (_) {}
    }
}

module.exports = {
    Result,
    RemoveReason,
    FrameType,
    FrameLength,
    Timing,
    EncodeFrame,
    DecodeFrames,
    LeaderOf,
    Match,
    Connectivity,
    RelayType,
    RelayRouting,
    RelayHeader,
    BuildConnect,
    ConnectReplyProblem,
    BuildSendToList,
    BuildBroadcast,
    BuildDisconnect,
    ReceivedPayload,
    Peer,
};
