// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Startup = 0xdc4ad1e0,
    Input = 0xdee061c6;
const History = 96;

function Frame(Type, Source, Body) {
    const FrameData = Buffer.alloc(16 + Body.length);
    FrameData.writeUInt32LE(FrameData.length);
    FrameData.writeUInt32LE(Type, 4);
    FrameData.writeBigUInt64LE(Source, 8);
    Body.copy(FrameData, 16);
    return FrameData;
}

function Decode(Body, Counts) {
    const Records = [];
    let At = 0;
    while (At < Body.length) {
        if (Body[At] === 0xf0) {
            if (Body.length - At < 4) throw new Error('truncated input NAK');
            Records.push({ Nak: { Requester: Body[At + 1], Machine: Body[At + 2], Frame: Body[At + 3] } });
            At += 4;
            continue;
        }
        if (Body.length - At < 2) throw new Error('invalid input batch');
        const Machine = Body[At] >>> 4,
            Count = (Body[At] & 15) + 1;
        if (Machine >= 10 || !Counts[Machine]) throw new Error('input machine has no startup controllers');
        let FrameData = Body[At + 1];
        At += 2;
        for (let I = 0; I < Count; I++) {
            if (At >= Body.length) throw new Error('truncated input record');
            const Base = 4 + 9 * Counts[Machine];
            const Length = Base + (Body[At] & 8 ? 10 : 0);
            if (At + Length > Body.length) throw new Error('truncated input record');
            const Bytes = Buffer.from(Body.subarray(At, At + Length));
            const Repeat = (Bytes[0] & 7) + 1;
            Records.push({
                Machine,
                Frame: FrameData,
                Repeat,
                Bytes,
                Delays: Bytes[0] & 8 ? Array.from(Bytes.subarray(Base)) : null,
            });
            FrameData = (FrameData + Repeat) & 255;
            At += Length;
        }
    }
    return Records;
}

class DelayService {
    constructor(Delay) {
        if (!Number.isInteger(Delay) || Delay < 1 || Delay > 49) throw new Error('lockstep delay must be 1..49 frames');
        this.Delay = Delay;
    }

    Process(Payload, Sender, Recipients, SessionClients) {
        const Messages = [];
        let HasLockstep = false;
        for (let At = 0; At < Payload.length;) {
            if (Payload.length - At < 16) return null;
            const Size = Payload.readUInt32LE(At);
            if (Size < 16 || At + Size > Payload.length) return null;
            const Message = Payload.subarray(At, At + Size);
            const Type = Message.readUInt32LE(4);
            if (Type === Startup || Type === Input) HasLockstep = true;
            Messages.push(Message);
            At += Size;
        }

        if (!HasLockstep) return null;

        const Output = [];
        for (const Message of Messages) {
            const Type = Message.readUInt32LE(4),
                Source = Message.readBigUInt64LE(8);
            const Body = Message.subarray(16);
            if (Type !== Startup && Type !== Input) {
                Output.push({ Payload: Message, Recipients: Recipients });
                continue;
            }
            if (Source !== Sender.MachineId) throw new Error('lockstep source does not match registered machine');
            if (Type === Startup) {
                if (Body.length !== 19 || Body[0] >= 10 || Body[8] !== 96) throw new Error('invalid mode-3 startup');
                const Counts = Array.from(Body.subarray(9, 19));
                const FrameRate = Body.readFloatBE(4);
                if (!Number.isFinite(FrameRate) || FrameRate < 1 || FrameRate > 240)
                    throw new Error('invalid startup frame rate');
                if (!Counts[Body[0]] || Counts.some((N) => N > 9)) throw new Error('invalid startup controller map');
                for (const Peer of SessionClients) {
                    if (Peer === Sender || !Peer.Lockstep) continue;
                    if (
                        Peer.Lockstep.Index === Body[0] ||
                        Peer.Lockstep.FrameRate !== FrameRate ||
                        !Peer.Lockstep.Counts.every((N, I) => N === Counts[I])
                    )
                        throw new Error('conflicting mode-3 machine/controller map');
                }
                if (Sender.Lockstep && !Sender.Lockstep.Startup.equals(Body))
                    throw new Error('changed lockstep startup requires reconnect');
                Sender.Lockstep ||= {
                    Index: Body[0],
                    Counts: Counts,
                    FrameRate: FrameRate,
                    Startup: Buffer.from(Body),
                    Frames: new Map(),
                    Latest: null,
                };
                Output.push({ Payload: Message, Recipients: Recipients });
                continue;
            }
            const State = Sender.Lockstep;
            if (!State) throw new Error('mode-3 input arrived before startup; awaiting startup retry');
            const Records = Decode(Body, State.Counts);
            if (
                Records.some((R) =>
                    R.Nak
                        ? R.Nak.Requester !== State.Index || R.Nak.Machine !== State.Index
                        : R.Machine !== State.Index,
                )
            )
                throw new Error('input machine index does not match startup');
            for (const Record of Records) {
                if (Record.Nak) {
                    for (const Peer of SessionClients) {
                        const Cached = Peer.Lockstep?.Frames.get(Record.Nak.Frame);
                        if (Cached)
                            Output.push({
                                Payload: Cached.Packet,
                                Recipients: [Sender],
                                Source: Peer,
                                FrameIndex: Cached.Absolute,
                                Retransmit: true,
                            });
                    }
                    continue;
                }
                const Bytes = Buffer.from(Record.Bytes);
                Bytes[0] &= ~7;
                for (let I = 0; I < Record.Repeat; I++) {
                    const Wire = (Record.Frame + I + this.Delay) & 255;
                    const Absolute =
                        State.Latest === null
                            ? Wire
                            : State.Latest + (((Wire - (State.Latest & 255) + 128) & 255) - 128);
                    if (State.Latest !== null && Absolute <= State.Latest - History) continue;
                    if (State.Latest === null || Absolute > State.Latest) {
                        State.Latest = Absolute;
                        for (const [Key, Cached] of State.Frames) {
                            if (Cached.Absolute <= Absolute - History) State.Frames.delete(Key);
                        }
                    }
                    const Packet = Frame(
                        Input,
                        Source,
                        Buffer.concat([Buffer.from([Record.Machine << 4, Wire]), Bytes]),
                    );
                    State.Frames.set(Wire, { Absolute: Absolute, Packet: Packet });
                    while (State.Frames.size > History) State.Frames.delete(State.Frames.keys().next().value);
                    Output.push({ Payload: Packet, Recipients: Recipients, Source: Sender, FrameIndex: Absolute });
                }
            }
        }
        return Output;
    }
}

module.exports = { Startup, Input, History, Frame, Decode, DelayService };
