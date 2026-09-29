// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { History } = require('./LockstepDelay');

class Pacer {
    constructor(Hz = 0) {
        if (!Number.isInteger(Hz) || Hz < 0 || Hz > 240)
            throw new Error('lockstep pacing Hz must be 0 (native) or 1..240');
        this.Hz = Hz;
        this.Sessions = new Map();
        this.Released = 0;
    }

    Queue(Delivery, Type) {
        const Source = Delivery.Source;
        const Key = Source.SessionKey;
        let Session = this.Sessions.get(Key);
        if (!Session) {
            Session = {
                Rate: this.Hz || Source.Lockstep.FrameRate,
                NativeRate: Source.Lockstep.FrameRate,
                Counts: Source.Lockstep.Counts,
                Next: 0,
                Deadline: null,
                Pending: new Map(),
                Sources: new Map(),
            };
            this.Sessions.set(Key, Session);
        }
        if (Session.NativeRate !== Source.Lockstep.FrameRate) throw new Error('lockstep frame rates disagree');
        const Index = Source.Lockstep.Index;
        const PreviousSource = Session.Sources.get(Index);
        if (PreviousSource && PreviousSource !== Source)
            throw new Error('lockstep source changed; reconnect the match');
        Session.Sources.set(Index, Source);
        if (Delivery.FrameIndex < Session.Next) {
            return Delivery.Retransmit ? [{ ...Delivery, Type: Type }] : [];
        }
        if (Delivery.Retransmit) return [];
        if (Delivery.FrameIndex >= Session.Next + History) throw new Error('lockstep input exceeds paced queue window');
        let Frame = Session.Pending.get(Delivery.FrameIndex);
        if (!Frame) Session.Pending.set(Delivery.FrameIndex, (Frame = new Map()));
        if (!Frame.has(Index)) Frame.set(Index, { ...Delivery, Type: Type });
        return [];
    }

    Prune(Clients) {
        const Live = new Set(Clients);
        for (const [Key, Session] of this.Sessions) {
            if ([...Session.Sources.values()].some((Source) => !Live.has(Source))) this.Sessions.delete(Key);
        }
    }

    Drain(Now, Clients) {
        const Live = new Set(Clients),
            Output = [];
        this.Prune(Live);
        const Rooms = new Map();
        for (const Client of Live) {
            if (!Rooms.has(Client.SessionKey)) Rooms.set(Client.SessionKey, []);
            Rooms.get(Client.SessionKey).push(Client);
        }
        for (const Session of this.Sessions.values()) {
            if (Session.Deadline !== null && Now + 0.000001 < Session.Deadline) continue;
            const Frame = Session.Pending.get(Session.Next);
            if (!Frame) continue;
            const Required = Session.Counts.flatMap((Count, Index) => (Count ? [Index] : []));
            if (!Required.every((Index) => Frame.has(Index) && Live.has(Frame.get(Index).Source))) continue;
            const Deliveries = new Map();
            for (const Index of Required) {
                const Entry = Frame.get(Index);
                const Recipients =
                    Entry.Routing === undefined
                        ? Entry.Recipients
                        : (Rooms.get(Entry.Source.SessionKey) || []).filter(
                              (C) =>
                                  Entry.Routing === 3 ||
                                  (Entry.Routing === 2 && C !== Entry.Source) ||
                                  (Entry.Routing === 1 && Entry.Selected?.has(C.MachineId)),
                          );
                for (const Recipient of Recipients) {
                    if (!Live.has(Recipient)) continue;
                    let Types = Deliveries.get(Recipient);
                    if (!Types) Deliveries.set(Recipient, (Types = new Map()));
                    if (!Types.has(Entry.Type)) Types.set(Entry.Type, []);
                    Types.get(Entry.Type).push(Entry.Payload);
                }
            }
            for (const [Recipient, Types] of Deliveries) {
                for (const [Type, Packets] of Types) {
                    Output.push({ Payload: Buffer.concat(Packets), Recipients: [Recipient], Type: Type });
                }
            }
            Session.Pending.delete(Session.Next++);
            this.Released++;
            const Period = 1000 / Session.Rate;
            const Next = Session.Deadline === null ? Now + Period : Session.Deadline + Period;
            Session.Deadline = Next > Now ? Math.max(Next, Now + Period * 0.75) : Now + Period;
        }
        return Output;
    }

    Summary() {
        const Frames = this.Released;
        this.Released = 0;
        if (!this.Sessions.size && !Frames) return null;
        const Rates = [...new Set([...this.Sessions.values()].map((S) => S.Rate))].join('/');
        const Queued = [...this.Sessions.values()].reduce((Sum, S) => Sum + S.Pending.size, 0);
        return `lockstep clock: ${Frames} complete ticks released, ${this.Sessions.size} match clock(s), target ${Rates || '-'} Hz, ${Queued} ticks queued`;
    }
}

module.exports = { Pacer };
