// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Test = require('node:test');
const Assert = require('node:assert/strict');
const Relay = require('../Source/Net/VconlineRelay');
const Peer = require('../Source/Net/PlayNowPeer');

const { Result, FrameType, Timing } = Peer;
const RelayId = 0x2628;
const T0 = 1000;
const Token = Buffer.from('00112233445566778899aabbccddeeff', 'hex');

function MatchFor(OurMachineId, MachineIds, Sequence = 5n) {
    return new Peer.Match({
        TicketId: 0x1234n,
        Sequence,
        OurMachineId,
        RelayToken: Token,
        RelayId: RelayId,
        RelayHost: '127.0.0.1',
        RelayPort: 28091,
        MachineIds,
    });
}

class Network {
    constructor() {
        this.Queue = [];
        this.Machines = new Map();
        this.Router = new Relay.Router((Packet, Client) => this.Queue.push({ Packet, port: Client.Port }));
        this.NextPort = 41000;
    }

    Join(Match, { Deaf = false } = {}) {
        const Endpoint = { address: '127.0.0.1', port: this.NextPort++ };
        const Machine = { Endpoint: Endpoint, Match: Match, Deaf: Deaf, Silent: false, Errors: [] };
        Machine.Connectivity = new Peer.Connectivity(Match, {
            SendToList: (Ids, Payload, Reliable) =>
                this.Send(Machine, Peer.BuildSendToList(Match.RelayId, Ids, Payload, Reliable)),
            Broadcast: (Payload, Reliable, All) =>
                this.Send(Machine, Peer.BuildBroadcast(Match.RelayId, Payload, Reliable, All)),
        });
        this.Machines.set(Endpoint.port, Machine);
        this.Router.Handle(Peer.BuildConnect(Match.RelayId, Match.RelayToken, Match.OurMachineId), Endpoint);
        const Reply = this.Queue.pop();
        Assert.equal(Reply.port, Endpoint.port);
        Assert.equal(Peer.ConnectReplyProblem(Reply.Packet, Match.RelayId, Match.OurMachineId), null);
        return Machine;
    }

    Send(Machine, Datagram) {
        if (Machine.Silent) return Result.Success;
        this.Router.Handle(Datagram, Machine.Endpoint);
        return Result.Success;
    }

    Deliver(Now) {
        while (this.Queue.length) {
            const { Packet, port: Port } = this.Queue.shift();
            const Machine = this.Machines.get(Port);
            if (!Machine || Machine.Deaf) continue;
            const Payload = Peer.ReceivedPayload(Packet, Machine.Match.RelayId);
            if (!Payload) continue;
            for (const Frame of Peer.DecodeFrames(Payload)) {
                const Outcome = Machine.Connectivity.PacketReceived(Frame, Now);
                if (Outcome !== Result.Success) Machine.Errors.push({ Now, Type: Frame.Type, Result: Outcome });
            }
        }
    }

    Step(Now, Machines = [...this.Machines.values()]) {
        this.Deliver(Now);
        const Results = new Map();
        for (const Machine of Machines) Results.set(Machine, Machine.Connectivity.Update(Now));
        this.Deliver(Now);
        return Results;
    }
}

function Start(NetworkValue, Ids, Sequence = 5n) {
    const Machines = Ids.map((Id) => NetworkValue.Join(MatchFor(Id, Ids, Sequence)));
    for (const Machine of Machines) Machine.Connectivity.NewMatchState(Ids, T0);
    return Machines;
}

Test('connectivity frames are the exact structs the executable sends', () => {
    const Leader = Peer.EncodeFrame(FrameType.Leader, 0x0110000100000666n, 5n);
    Assert.equal(Leader.readBigUInt64LE(0), 0x5c85bd1500000018n);
    Assert.equal(Leader.readBigUInt64LE(8), 0x0110000100000666n);
    Assert.equal(Leader.readBigUInt64LE(16), 0x0500000000000000n, 'sequence is byte-swapped');

    const Connectivity = Peer.EncodeFrame(FrameType.Connectivity, 7n, 5n);
    Assert.equal(Connectivity.readUInt16LE(0), 24);
    Assert.equal(Connectivity.readUInt16LE(2), 0);
    Assert.equal(Connectivity.readUInt32LE(4), 1847743383);

    Assert.equal(Peer.EncodeFrame(FrameType.Echo, 7n, 5n).readBigUInt64LE(0), 0x41bf6bc300000018n);

    const Leave = Peer.EncodeFrame(FrameType.Leave, 9n);
    Assert.equal(Leave.length, 16);
    Assert.equal(Leave.readBigUInt64LE(0), 0x4149111c00000010n);
    Assert.equal(Leave.readBigUInt64LE(8), 9n);
});

Test('a relay payload splits into frames by their own length, as PACKET_HANDLER::Update walks it', () => {
    const Payload = Buffer.concat([
        Peer.EncodeFrame(FrameType.Leader, 1n, 5n),
        Peer.EncodeFrame(FrameType.Leave, 2n),
        Peer.EncodeFrame(FrameType.Connectivity, 3n, 5n),
    ]);
    const Frames = Peer.DecodeFrames(Payload);
    Assert.deepEqual(
        Frames.map((F) => F.Type),
        [FrameType.Leader, FrameType.Leave, FrameType.Connectivity],
    );
    Assert.deepEqual(
        Frames.map((F) => F.SubjectMachineId),
        [1n, 2n, 3n],
    );
    Assert.deepEqual(
        Frames.map((F) => F.Sequence),
        [5n, null, 5n],
    );
    const Truncated = Buffer.from(Payload.subarray(0, 56));
    Assert.equal(Peer.DecodeFrames(Truncated).length, 2);
});

Test('relay datagrams carry the header bits VCONLINE_RELAY builds', () => {
    const Connect = Peer.BuildConnect(RelayId, Token, 0xabcdn);
    Assert.equal(Connect.readUInt32BE(0), (0x1c0000 | RelayId) >>> 0);
    Assert.deepEqual(Connect.subarray(4, 20), Token);
    Assert.equal(Connect.readBigUInt64BE(20), 0xabcdn);

    const List = Peer.BuildSendToList(RelayId, [5n, 6n], Buffer.from('xy'), true);
    const ListWord = List.readUInt32BE(0);
    Assert.equal(ListWord >>> 29, 4);
    Assert.equal((ListWord >>> 27) & 3, 1);
    Assert.equal((ListWord >>> 16) & 0x7ff, List.length);
    Assert.equal(List.readUInt32BE(4), 2);
    Assert.equal(List.readBigUInt64BE(16), 6n);

    Assert.equal((Peer.BuildBroadcast(RelayId, Buffer.alloc(4), false, false).readUInt32BE(0) >>> 27) & 3, 2);
    Assert.equal((Peer.BuildBroadcast(RelayId, Buffer.alloc(4), false, true).readUInt32BE(0) >>> 27) & 3, 3);

    Assert.equal(Peer.BuildDisconnect(RelayId, 1n).readUInt32BE(0), (0x400c0000 | RelayId) >>> 0);
});

Test("Opal's connect reply passes every check the client makes, and each broken field fails", () => {
    const Good = Relay.BuildConnectReply(RelayId, 0x99n);
    Assert.equal(Peer.ConnectReplyProblem(Good, RelayId, 0x99n), null);
    Assert.match(Peer.ConnectReplyProblem(Good, RelayId, 0x98n), /another machine/);
    Assert.match(Peer.ConnectReplyProblem(Good, RelayId + 1, 0x99n), /relay id/);
    Assert.match(Peer.ConnectReplyProblem(Relay.BuildConnectReply(RelayId, 0x99n, 7), RelayId, 0x99n), /status 7/);
    Assert.match(Peer.ConnectReplyProblem(Good.subarray(0, 15), RelayId, 0x99n), /15 bytes/);
});

Test('the leader is the unsigned minimum machine id, 0 for an empty list', () => {
    Assert.equal(Peer.LeaderOf([0x8000000000000001n, 0x0110000100000666n]), 0x0110000100000666n);
    Assert.equal(Peer.LeaderOf([3n, 1n, 2n]), 1n);
    Assert.equal(Peer.LeaderOf([]), 0n);
    Assert.equal(MatchFor(9n, [9n, 4n]).LeaderMachineId, 4n);
});

Test('a leader and a client settle: heartbeats each second, connectivity each 3 s and on every heartbeat', () => {
    const Net = new Network();
    const [Leader, Client] = Start(Net, [0x0110000100000666n, 0x0110000100000777n]);
    Assert.equal(Leader.Match.LeaderMachineId, Leader.Match.OurMachineId);
    Assert.equal(Client.Match.LeaderMachineId, Leader.Match.OurMachineId);

    const End = T0 + 30;
    for (let Now = T0; Now <= End; Now += 0.25) {
        const Results = Net.Step(Now);
        Assert.equal(Results.get(Leader), Result.Success, `leader at ${Now}`);
        Assert.equal(Results.get(Client), Result.Success, `client at ${Now}`);
    }

    Assert.equal(Leader.Connectivity.Sent.Leader, 31);
    Assert.equal(Client.Connectivity.Received.Leader, 31);
    Assert.ok(Client.Connectivity.Sent.Connectivity >= 31);
    Assert.equal(Leader.Connectivity.Received.Connectivity, Client.Connectivity.Sent.Connectivity);
    Assert.deepEqual(Leader.Errors, []);
    Assert.deepEqual(Client.Errors, []);
    Assert.ok(
        End - Client.Connectivity.Nodes.get(Leader.Match.OurMachineId).LastConnectivity <= Timing.HeartbeatSeconds,
    );
    Assert.ok(
        End - Leader.Connectivity.Nodes.get(Client.Match.OurMachineId).LastConnectivity <= Timing.HeartbeatSeconds,
    );
});

Test('six machines agree on one leader and every client reaches it', () => {
    const Ids = [60n, 20n, 50n, 10n, 40n, 30n];
    const Net = new Network();
    const Machines = Start(Net, Ids);
    for (let Now = T0; Now <= T0 + 15; Now += 0.5) {
        for (const [Machine, Outcome] of Net.Step(Now))
            Assert.equal(Outcome, Result.Success, `${Machine.Match.OurMachineId} at ${Now}`);
    }
    const Leader = Machines.find((M) => M.Match.OurMachineId === 10n);
    Assert.ok(Machines.every((M) => M.Match.LeaderMachineId === 10n));
    Assert.equal(Leader.Connectivity.Nodes.size, 6);
    for (const Client of Machines.filter((M) => M !== Leader)) {
        Assert.equal(Client.Connectivity.Received.Leader, Leader.Connectivity.Sent.Leader);
        Assert.deepEqual(Client.Errors, []);
    }
});

Test("a silent leader is confirmed by the client's own echoes, removed, and the client takes over", () => {
    const Net = new Network();
    const [Leader, Client] = Start(Net, [100n, 200n]);
    for (let NowValue = T0; NowValue <= T0 + 5; NowValue += 0.5) Net.Step(NowValue);

    Leader.Silent = true;
    let Now = T0 + 5;
    let SawWaiting = false;
    for (; Now <= T0 + 40 && Client.Match.LeaderMachineId === 100n; Now += 0.5) {
        const Outcome = Net.Step(Now, [Client]).get(Client);
        if (Outcome === Result.WaitingForEcho) SawWaiting = true;
        else Assert.equal(Outcome, Result.Success, `client at ${Now}`);
    }

    Assert.ok(SawWaiting, 'the client ran the echo self-test');
    Assert.ok(Client.Connectivity.Received.Echo >= Timing.EchoesBeforeRemovingLeader);
    Assert.equal(Client.Match.LeaderMachineId, 200n, 'the client is now the lowest remaining machine');
    Assert.deepEqual(Client.Match.RemoveRequests, [{ MachineId: 100n, Reason: Peer.RemoveReason.LeaderLostAfterEcho }]);
    Assert.equal(Client.Connectivity.Sent.Leave, 1);
    Assert.equal(Client.Connectivity.Nodes.has(100n), false);
    Assert.equal(Net.Step(Now, [Client]).get(Client), Result.Success);
});

Test('when its own echoes never return the client gives up with LeaderUnresponsive', () => {
    const Net = new Network();
    const [Leader, Client] = Start(Net, [100n, 200n]);
    for (let Now = T0; Now <= T0 + 5; Now += 0.5) Net.Step(Now);
    Leader.Silent = true;
    Client.Deaf = true;

    let Last;
    for (let Now = T0 + 5; Now <= T0 + 40; Now += 0.5) Last = Net.Step(Now, [Client]).get(Client);
    Assert.equal(Last, Result.LeaderUnresponsive);
    Assert.equal(Client.Connectivity.Fatal, Result.LeaderUnresponsive);
    Assert.equal(Client.Connectivity.Sent.Echo, Timing.MaxEchoRetries);
    Assert.equal(Client.Match.LeaderMachineId, 100n, "nothing is removed on the client's own failure");
});

Test('the leader removes a client silent for MAX_MISSING_HEARTBEAT_SECONDS', () => {
    const Net = new Network();
    const [Leader, Quiet, Active] = Start(Net, [1n, 2n, 3n]);
    for (let Now = T0; Now <= T0 + 5; Now += 0.5) Net.Step(Now);
    Quiet.Silent = true;
    for (let Now = T0 + 5; Now <= T0 + 20; Now += 0.5) {
        Assert.equal(Net.Step(Now, [Leader, Active]).get(Leader), Result.Success, `leader at ${Now}`);
    }
    Assert.equal(Leader.Connectivity.Nodes.has(2n), false);
    Assert.equal(Leader.Connectivity.Nodes.has(3n), true);
    Assert.deepEqual(Leader.Match.RemoveRequests, [{ MachineId: 2n, Reason: Peer.RemoveReason.Unresponsive }]);
});

Test('raw packets keep a machine whose connectivity lapsed', () => {
    const C = new Peer.Connectivity(MatchFor(1n, [1n, 2n, 3n]), {
        SendToList: () => Result.Success,
        Broadcast: () => Result.Success,
    });
    C.NewMatchState([1n, 2n, 3n], T0);
    const Raw = (Subject, Now) =>
        C.PacketReceived({ Type: 0xdeadbeef, Length: 16, SubjectMachineId: Subject, Sequence: null }, Now);
    Raw(2n, T0 + 9);
    for (let T = T0 + 1; T <= T0 + 20; T += 1) Raw(3n, T);
    Assert.equal(C.Update(T0 + 15), Result.Success);
    Assert.equal(C.Nodes.has(2n), true, 'kept: its raw traffic 6 s ago is inside 10 s');
    Assert.equal(C.Update(T0 + 20), Result.Success);
    Assert.equal(C.Nodes.has(2n), false, 'removed once both of its stamps are 10 s old');
    Assert.equal(C.Nodes.has(3n), true, 'machine 3 is still sending');
});

Test('peers holding different sequences disagree in either order; equal sequences are quiet', () => {
    const Ids = [100n, 200n];
    const Run = (LeaderSequence, ClientSequence) => {
        const Net = new Network();
        const Leader = Net.Join(MatchFor(100n, Ids, LeaderSequence));
        const Client = Net.Join(MatchFor(200n, Ids, ClientSequence));
        Leader.Connectivity.NewMatchState(Ids, T0);
        Client.Connectivity.NewMatchState(Ids, T0);
        for (let Now = T0; Now <= T0 + 4; Now += 0.5) Net.Step(Now);
        return { Leader, Client };
    };

    const Ahead = Run(6n, 5n);
    Assert.ok(Ahead.Leader.Errors.some((E) => E.Result === Result.StaleSequence));
    Assert.equal(Ahead.Client.Match.NewestSequenceSeen, 6n);

    const Behind = Run(5n, 6n);
    Assert.equal(Behind.Leader.Match.NewestSequenceSeen, 6n);

    const Agreed = Run(5n, 5n);
    Assert.deepEqual(Agreed.Leader.Errors, []);
    Assert.deepEqual(Agreed.Client.Errors, []);
    Assert.equal(Agreed.Leader.Match.NewestSequenceSeen, 0n);
    Assert.equal(Agreed.Client.Match.NewestSequenceSeen, 0n);
});

Test('Update refuses to run without an identity, off the list, or with the leader missing', () => {
    const Quiet = { SendToList: () => Result.Success, Broadcast: () => Result.Success };
    const None = new Peer.Connectivity(MatchFor(0n, [1n]), Quiet);
    None.NewMatchState([1n], T0);
    Assert.equal(None.Update(T0 + 1), Result.NoOurMachineId);

    const Stranger = new Peer.Connectivity(MatchFor(9n, [1n, 2n]), Quiet);
    Stranger.NewMatchState([1n, 2n], T0);
    Assert.equal(Stranger.Update(T0 + 1), Result.OurMachineNotInList);

    const Orphan = new Peer.Connectivity(MatchFor(2n, [1n, 2n]), Quiet);
    Orphan.NewMatchState([2n], T0);
    Assert.equal(Orphan.Update(T0 + 1), Result.LeaderNotInList);
    Assert.equal(Orphan.Match.FirstError, Result.LeaderNotInList);
});

Test('a leader alone for MAX_MISSING_HEARTBEAT_SECONDS stops with NoTrafficAsLeader', () => {
    const C = new Peer.Connectivity(MatchFor(1n, [1n, 2n]), {
        SendToList: () => Result.Success,
        Broadcast: () => Result.Success,
    });
    C.NewMatchState([1n, 2n], T0);
    Assert.equal(C.Update(T0 + 9.5), Result.Success);
    Assert.equal(C.Update(T0 + 10), Result.NoTrafficAsLeader);
});

Test('frames are refused the way PacketReceived and TestForEcho refuse them', () => {
    const C = new Peer.Connectivity(MatchFor(2n, [1n, 2n]), {
        SendToList: () => Result.Success,
        Broadcast: () => Result.Success,
    });
    C.NewMatchState([1n, 2n], 0);
    Assert.equal(
        C.PacketReceived({ Type: FrameType.Echo, Length: 24, SubjectMachineId: 1n, Sequence: 5n }, 1),
        Result.EchoFromOtherMachine,
    );
    Assert.equal(
        C.PacketReceived({ Type: FrameType.Leader, Length: 16, SubjectMachineId: 1n, Sequence: null }, 1),
        Result.ShortFrame,
    );
    Assert.equal(
        C.PacketReceived({ Type: 0x12345678, Length: 16, SubjectMachineId: 1n, Sequence: null }, 1),
        Result.UnknownFrame,
    );
});

Test('a Leave removes that machine, recomputes the leader and asks the server to drop it', () => {
    const C = new Peer.Connectivity(MatchFor(3n, [1n, 2n, 3n]), {
        SendToList: () => Result.Success,
        Broadcast: () => Result.Success,
    });
    C.NewMatchState([1n, 2n, 3n], 0);
    const Frame = Peer.DecodeFrames(Peer.EncodeFrame(FrameType.Leave, 1n))[0];
    Assert.equal(C.PacketReceived(Frame, 2), Result.Success);
    Assert.equal(C.Nodes.has(1n), false);
    Assert.equal(C.Match.LeaderMachineId, 2n);
    Assert.deepEqual(C.Match.RemoveRequests, [{ MachineId: 1n, Reason: Peer.RemoveReason.LeavePacket }]);
    Assert.equal(C.Match.SendRemoveRequest(3n, 0), Result.RemoveOurselves, 'a machine never removes itself');
});
