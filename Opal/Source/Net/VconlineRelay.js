// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Dgram = require('dgram');
const Log = require('../Core/Log');
const Capture = require('./Capture');
const { performance: Perf } = require('node:perf_hooks');

const Type = Object.freeze({
    Connect: 0,
    ConnectReply: 1,
    Disconnect: 2,
    Unreliable: 3,
    Reliable: 4,
});

const Routing = Object.freeze({
    Delivered: 0,
    List: 1,
    Others: 2,
    All: 3,
});

const MaxPacket = 0x7ff;
const ConnectLength = 28;
const ConnectReplyLength = 16;
const DisconnectLength = 12;
const IdleMs = 70_000;

const P2PControlType = Object.freeze({
    Leave: 0x4149111c,
    Echo: 0x41bf6bc3,
    Leader: 0x5c85bd15,
    Connectivity: 0x6e225397,
});
const P2PControlName = new Map(Object.entries(P2PControlType).map(([Name, Value]) => [Value, Name]));

function ParseP2PControlFrames(Payload) {
    if (!Buffer.isBuffer(Payload)) return [];
    const Controls = [];
    for (let At = 0; At < Payload.length;) {
        if (Payload.length - At < 16) return [];
        const Length = Payload.readUInt32LE(At);
        if (Length < 16 || At + Length > Payload.length) return [];
        const TypeCode = Payload.readUInt32LE(At + 4);
        const Name = P2PControlName.get(TypeCode);
        if (Name) {
            const Expected = TypeCode === P2PControlType.Leave ? 16 : 24;
            if (Length !== Expected) return [];
            Controls.push({
                Name: Name,
                Type: TypeCode,
                SubjectMachineId: Payload.readBigUInt64LE(At + 8),
                MatchSequence: Length === 24 ? Payload.readBigUInt64BE(At + 16) : null,
            });
        }
        At += Length;
    }
    return Controls;
}

function LowestMachineId(Clients) {
    let Leader = null;
    for (const Client of Clients) {
        if (Leader === null || Client.MachineId < Leader) Leader = Client.MachineId;
    }
    return Leader;
}

class TrafficSummary {
    constructor() {
        this.Reset();
    }
    Reset() {
        this.In = 0;
        this.Attempted = 0;
        this.Completed = 0;
        this.Failed = 0;
        this.NoRecipients = 0;
    }
    Take() {
        if (!(this.In || this.Attempted || this.Completed || this.Failed)) return null;
        const Result =
            `relay interval: ${this.In} data datagrams in, ${this.Attempted} sends attempted, ` +
            `${this.Completed} OS send completions, ${this.Failed} send errors, ${this.NoRecipients} without recipients`;
        this.Reset();
        return Result;
    }
}

function BuildHeader(TypeCode, RoutingValue, Length, RelayId) {
    if (!Number.isInteger(TypeCode) || TypeCode < 0 || TypeCode > 7) throw new Error('relay type is out of range');
    if (!Number.isInteger(RoutingValue) || RoutingValue < 0 || RoutingValue > 3)
        throw new Error('relay routing is out of range');
    if (!Number.isInteger(Length) || Length < 4 || Length > MaxPacket) {
        throw new Error(`relay packet length ${Length} is out of range`);
    }
    if (!Number.isInteger(RelayId) || RelayId < 0 || RelayId > 0xffff) {
        throw new Error('relay id is out of range');
    }
    return (
        (((TypeCode & 7) << 29) | ((RoutingValue & 3) << 27) | ((Length & MaxPacket) << 16) | (RelayId & 0xffff)) >>> 0
    );
}

function ParseHeader(Packet) {
    if (!Buffer.isBuffer(Packet) || Packet.length < 4) {
        throw new Error('relay datagram is shorter than its four-byte header');
    }
    const Word = Packet.readUInt32BE(0);
    const Header = {
        Word: Word,
        Type: Word >>> 29,
        Routing: (Word >>> 27) & 3,
        Length: (Word >>> 16) & MaxPacket,
        RelayId: Word & 0xffff,
    };
    if (Header.Length !== Packet.length) {
        throw new Error(`relay header declares ${Header.Length} bytes but ${Packet.length} arrived`);
    }
    return Header;
}

function BuildConnectReply(RelayId, MachineId, Status = 0) {
    const Reply = Buffer.alloc(ConnectReplyLength);
    Reply.writeUInt32BE(BuildHeader(Type.ConnectReply, Routing.Delivered, ConnectReplyLength, RelayId), 0);
    Reply.writeUInt32BE(Status >>> 0, 4);
    Reply.writeBigUInt64BE(BigInt.asUintN(64, BigInt(MachineId)), 8);
    return Reply;
}

function BuildDelivery(TypeCode, RelayId, Payload) {
    const Body = Buffer.from(Payload || []);
    const Length = 4 + Body.length;
    const Packet = Buffer.alloc(Length);
    Packet.writeUInt32BE(BuildHeader(TypeCode, Routing.Delivered, Length, RelayId), 0);
    Body.copy(Packet, 4);
    return Packet;
}

function EndpointKey(Endpoint) {
    return `${Endpoint.address}:${Endpoint.port}`;
}

class Router {
    constructor(Send, Now = () => Perf.now(), { LockstepDelayFrames = 0, LockstepPacing = true, LockstepHz = 0 } = {}) {
        if (typeof Send !== 'function') throw new Error('relay router needs a send function');
        this.Send = Send;
        this.Now = Now;
        this.Clients = new Map();
        this.LockstepDelay = LockstepDelayFrames
            ? new (require('./LockstepDelay').DelayService)(LockstepDelayFrames)
            : null;
        this.Pacer = this.LockstepDelay && LockstepPacing ? new (require('./LockstepPacer').Pacer)(LockstepHz) : null;
    }

    Prune() {
        const Oldest = this.Now() - IdleMs;
        for (const [Key, Client] of this.Clients) {
            if (Client.SeenAt < Oldest) this.Clients.delete(Key);
        }
        this.Pacer?.Prune(this.Clients.values());
    }

    Deliver(Deliveries, FallbackType = Type.Unreliable) {
        let Sent = 0;
        for (const Delivery of Deliveries) {
            for (const Recipient of Delivery.Recipients) {
                this.Send(BuildDelivery(Delivery.Type ?? FallbackType, Recipient.RelayId, Delivery.Payload), Recipient);
                Recipient.Sent++;
                Sent++;
            }
        }
        return Sent;
    }

    Pump() {
        if (!this.Pacer) return 0;
        this.Prune();
        return this.Deliver(this.Pacer.Drain(this.Now(), this.Clients.values()));
    }

    Handle(Packet, Remote) {
        this.Prune();
        const Header = ParseHeader(Packet);
        const Key = EndpointKey(Remote);

        if (Header.Type === Type.Connect) {
            if (Header.Routing !== Routing.Delivered || Packet.length !== ConnectLength) {
                throw new Error(`invalid ${Packet.length}-byte relay connect datagram`);
            }
            const Token = Buffer.from(Packet.subarray(4, 20));
            const MachineId = Packet.readBigUInt64BE(20);
            if (!MachineId || Token.equals(Buffer.alloc(16)))
                throw new Error('relay connect requires machine id and nonzero token');
            const SessionKey = `${Header.RelayId}:${Token.toString('hex')}`;
            for (const [OldKey, Old] of this.Clients) {
                if (Old.SessionKey === SessionKey && Old.MachineId === MachineId) this.Clients.delete(OldKey);
            }
            const Client = {
                Address: Remote.address,
                Port: Remote.port,
                RelayId: Header.RelayId,
                MachineId: MachineId,
                SessionKey: SessionKey,
                Token: Token,
                SeenAt: this.Now(),
                Received: 1,
                Sent: 1,
                P2PControlTypes: new Set(),
            };
            this.Clients.set(Key, Client);
            this.Pacer?.Prune(this.Clients.values());
            this.Send(BuildConnectReply(Header.RelayId, MachineId), Client);
            const SessionClientsValue = Array.from(this.Clients.values()).filter(
                (Candidate) => Candidate.SessionKey === SessionKey,
            );
            return {
                Kind: 'connect',
                Client: Client,
                Sent: 1,
                SessionSize: SessionClientsValue.length,
                LeaderMachineId: LowestMachineId(SessionClientsValue),
            };
        }

        const Sender = this.Clients.get(Key);
        if (!Sender) throw new Error(`relay datagram from unregistered endpoint ${Key}`);
        Sender.SeenAt = this.Now();
        Sender.Received++;

        if (Header.RelayId !== Sender.RelayId) {
            throw new Error(`relay id ${Header.RelayId} does not match registered id ${Sender.RelayId}`);
        }

        if (Header.Type === Type.Disconnect) {
            if (Header.Routing !== Routing.Delivered || Packet.length !== DisconnectLength) {
                throw new Error(`invalid ${Packet.length}-byte relay disconnect datagram`);
            }
            const MachineId = Packet.readBigUInt64BE(4);
            if (MachineId !== Sender.MachineId) throw new Error('relay disconnect machine id does not match');
            this.Clients.delete(Key);
            this.Pacer?.Prune(this.Clients.values());
            return { Kind: 'disconnect', Client: Sender, Sent: 0 };
        }

        if (Header.Type !== Type.Unreliable && Header.Type !== Type.Reliable) {
            throw new Error(`unexpected client relay packet type ${Header.Type}`);
        }

        let BodyOffset = 4;
        let Selected = null;
        if (Header.Routing === Routing.List) {
            if (Packet.length < 8) throw new Error('relay list datagram has no recipient count');
            const Count = Packet.readUInt32BE(4);
            BodyOffset = 8 + Count * 8;
            if (BodyOffset > Packet.length) throw new Error('relay recipient list overruns its datagram');
            Selected = new Set();
            for (let At = 8; At < BodyOffset; At += 8) Selected.add(Packet.readBigUInt64BE(At));
        } else if (Header.Routing !== Routing.Others && Header.Routing !== Routing.All) {
            throw new Error(`client used invalid relay routing mode ${Header.Routing}`);
        }

        const Payload = Packet.subarray(BodyOffset);
        const Recipients = [];
        for (const [CandidateKey, Candidate] of this.Clients) {
            if (Candidate.SessionKey !== Sender.SessionKey) continue;
            if (Header.Routing === Routing.Others && CandidateKey === Key) continue;
            if (Selected && !Selected.has(Candidate.MachineId)) continue;
            Recipients.push(Candidate);
        }

        const SessionClients = Array.from(this.Clients.values()).filter((C) => C.SessionKey === Sender.SessionKey);
        const Controls = ParseP2PControlFrames(Payload);
        const NewControls = [];
        for (const Control of Controls) {
            const KeyValue = `${Control.Type}:${Control.SubjectMachineId}:${Control.MatchSequence}`;
            if (!Sender.P2PControlTypes.has(KeyValue)) {
                Sender.P2PControlTypes.add(KeyValue);
                NewControls.push(Control);
            }
        }
        const Deliveries = this.LockstepDelay?.Process(Payload, Sender, Recipients, SessionClients) || [
            { Payload: Payload, Recipients: Recipients },
        ];
        let Sent = 0,
            Queued = 0;
        for (const Delivery of Deliveries) {
            if (this.Pacer && Delivery.FrameIndex !== undefined) {
                Sent += this.Deliver(
                    this.Pacer.Queue({ ...Delivery, Routing: Header.Routing, Selected: Selected }, Header.Type),
                    Header.Type,
                );
                Queued++;
            } else Sent += this.Deliver([Delivery], Header.Type);
        }
        Sent += this.Pump();
        return {
            Kind: 'data',
            Client: Sender,
            Routing: Header.Routing,
            PayloadLength: Payload.length,
            Sent: Sent,
            Queued: Queued,
            P2PControls: NewControls,
            LeaderMachineId: LowestMachineId(SessionClients),
        };
    }
}

let Socket = null;
let ActiveRouterValue = null;

function TimingOptions(Env = process.env) {
    const LockstepDelayFrames = Number(Env.OPAL_LOCKSTEP_DELAY_FRAMES ?? Env.GRANITE_LOCKSTEP_BUFFER_FRAMES ?? 12);
    const LockstepHz = Number(Env.OPAL_LOCKSTEP_HZ || 83);
    if (!Number.isInteger(LockstepDelayFrames) || LockstepDelayFrames < 0 || LockstepDelayFrames > 49)
        throw new Error('OPAL_LOCKSTEP_DELAY_FRAMES must be 0 (off) or 1..49');
    if (!Number.isInteger(LockstepHz) || LockstepHz < 0 || LockstepHz > 240)
        throw new Error('OPAL_LOCKSTEP_HZ must be 0 (native) or 1..240');
    return { LockstepDelayFrames, LockstepHz };
}

function Start({
    port: Port = Number(process.env.OPAL_RELAY_PORT) || 28091,
    host: Host = process.env.OPAL_RELAY_BIND || '0.0.0.0',
} = {}) {
    if (Socket) return Socket;

    const { LockstepDelayFrames, LockstepHz } = TimingOptions();
    if (LockstepDelayFrames)
        Log.Info(
            `mode-3 input scheduling: +${LockstepDelayFrames} frame offset; ` +
                `target ${LockstepHz ? `${LockstepHz} Hz (${(1000 / LockstepHz).toFixed(2)} ms/tick)` : 'native startup rate'}; real-input cache enabled`,
        );

    const Udp = Dgram.createSocket('udp4');
    const Counts = new TrafficSummary();
    const FlushTraffic = () => {
        const Line = Counts.Take();
        if (Line) Log.Verbose(`  ${Line}`);
        const Pacing = Active.Pacer?.Summary();
        if (Pacing) Log.Verbose(`  ${Pacing}`);
    };
    const Active = new Router(
        (Packet, Client) => {
            Counts.Attempted++;
            Capture.RecordRelay('out', { address: Client.Address, port: Client.Port }, Packet);
            Udp.send(Packet, Client.Port, Client.Address, (Failure) => {
                if (Failure) {
                    Counts.Failed++;
                    Log.Error(`relay send to ${Client.Address}:${Client.Port} failed: ${Failure.message}`);
                } else Counts.Completed++;
            });
        },
        undefined,
        { LockstepDelayFrames, LockstepHz },
    );

    Udp.on('message', (Packet, Remote) => {
        Capture.RecordRelay('in', Remote, Packet);
        try {
            const Result = Active.Handle(Packet, Remote);
            if (Result.Kind === 'connect') {
                Log.Info(
                    `relay client ${Remote.address}:${Remote.port} connected as machine ` +
                        `0x${Result.Client.MachineId.toString(16).toUpperCase()} @ ${Log.Clock()}`,
                );
                Log.Verbose(
                    `  relay connect accepted, id ${Result.Client.RelayId}, ` +
                        `session token fingerprint ${require('node:crypto').createHash('sha256').update(Result.Client.Token).digest('hex').slice(0, 12)}`,
                );
                if (Result.SessionSize > 1)
                    Log.Info(
                        `Play Now relay session has ${Result.SessionSize} machines; ` +
                            `native leader is 0x${Result.LeaderMachineId.toString(16).toUpperCase()} @ ${Log.Clock()}`,
                    );
            } else if (Result.Kind === 'disconnect') {
                Log.Info(`relay client ${Remote.address}:${Remote.port} disconnected @ ${Log.Clock()}`);
            } else {
                Counts.In++;
                if (!Result.Sent && !Result.Queued) Counts.NoRecipients++;
                for (const Control of Result.P2PControls || []) {
                    const Sequence = Control.MatchSequence === null ? '' : `, match sequence ${Control.MatchSequence}`;
                    Log.Verbose(
                        `  Play Now ${Control.Name} ` +
                            `${Control.Type === P2PControlType.Leave ? 'for' : 'from'} ` +
                            `0x${Control.SubjectMachineId.toString(16).toUpperCase()}${Sequence}; ` +
                            `leader 0x${Result.LeaderMachineId.toString(16).toUpperCase()}`,
                    );
                }
            }
        } catch (Failure) {
            Log.Error(
                `relay dropped ${Packet.length}-byte datagram from ` +
                    `${Remote.address}:${Remote.port}: ${Failure.message}`,
            );
            Log.Verbose(`  relay bytes ${Packet.toString('hex')}`);
        }
    });

    Udp.on('error', (Failure) => {
        if (Failure.code === 'EADDRINUSE') {
            Log.Error(`relay port ${Port} is already in use; stop the other listener or set ` + `OPAL_RELAY_PORT.`);
        } else {
            Log.Error(`relay listener failed: ${Failure.message}`);
        }
        if (Socket === Udp) {
            Socket = null;
            ActiveRouterValue = null;
        }
        try {
            Udp.close();
        } catch (_) {}
        process.exitCode = 1;
    });

    Socket = Udp;
    ActiveRouterValue = Active;
    const SummaryTimer = setInterval(FlushTraffic, 5000);
    SummaryTimer.unref();
    const PacingTimer = Active.Pacer
        ? setInterval(() => {
              try {
                  Active.Pump();
              } catch (Failure) {
                  Log.Error(`lockstep clock: ${Failure.message}`);
              }
          }, 2)
        : null;
    PacingTimer?.unref();
    Udp.once('close', () => {
        clearInterval(SummaryTimer);
        if (PacingTimer) clearInterval(PacingTimer);
        FlushTraffic();
    });
    Udp.bind(Port, Host, () => {
        const Address = Udp.address();
        Log.Info(`opal relay listening on udp://${Address.address}:${Address.port} @ ${Log.Clock()}`);
    });
    return Udp;
}

function Stop() {
    const Open = Socket;
    Socket = null;
    ActiveRouterValue = null;
    if (!Open) return;
    try {
        Open.close();
    } catch (_) {}
}

function ActiveRouter() {
    return ActiveRouterValue;
}

module.exports = {
    Type,
    Routing,
    MaxPacket,
    ConnectLength,
    ConnectReplyLength,
    DisconnectLength,
    IdleMs,
    P2PControlType,
    ParseP2PControlFrames,
    LowestMachineId,
    BuildHeader,
    ParseHeader,
    BuildConnectReply,
    BuildDelivery,
    EndpointKey,
    Router,
    Start,
    Stop,
    ActiveRouter,
    TrafficSummary,
    TimingOptions,
};
