// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';
const Test = require('node:test');
const Assert = require('node:assert/strict');
const Relay = require('../Source/Net/VconlineRelay');
const { Frame, Startup, Input, Decode } = require('../Source/Net/LockstepDelay');

function Harness(Count = 2, Rate = 60, Hz = 0, Delay = 15) {
    let Now = 0;
    const Sent = [],
        Peers = [];
    const Router = new Relay.Router(
        (Packet, Client) => Sent.push({ Packet, Client, Time: Now }),
        () => Now,
        { LockstepDelayFrames: Delay, LockstepHz: Hz },
    );
    function Connect(Room, Index, Players = Count, HzValue = Rate) {
        const Peer = {
            address: '127.0.0.1',
            port: 10000 + Peers.length,
            Machine: BigInt(100 + Peers.length),
            index: Index,
            Room,
        };
        Peers.push(Peer);
        const Packet = Buffer.alloc(28, 1);
        Packet.writeUInt32BE(Relay.BuildHeader(0, 0, 28, 0));
        Packet.writeUInt32LE(Room, 4);
        Packet.writeBigUInt64BE(Peer.Machine, 20);
        Router.Handle(Packet, Peer);
        const StartupBody = Buffer.from('01010301427000006001010000000000000000', 'hex');
        StartupBody[0] = Index;
        StartupBody.writeFloatBE(HzValue, 4);
        StartupBody.fill(0, 9);
        StartupBody.fill(1, 9, 9 + Players);
        Data(Peer, Frame(Startup, Peer.Machine, StartupBody));
        return Peer;
    }
    function Data(Peer, Payload) {
        const Packet = Buffer.alloc(4 + Payload.length);
        Packet.writeUInt32BE(Relay.BuildHeader(3, 3, Packet.length, 0));
        Payload.copy(Packet, 4);
        return Router.Handle(Packet, Peer);
    }
    function InputData(Peer, FrameData) {
        const Record = Buffer.from('205300000000000000c04062a3', 'hex');
        return Data(
            Peer,
            Frame(
                Input,
                Peer.Machine,
                Buffer.concat([Buffer.from([Peer.index << 4, (FrameData - Delay) & 255]), Record]),
            ),
        );
    }
    function Nak(Peer, FrameData) {
        return Data(Peer, Frame(Input, Peer.Machine, Buffer.from([0xf0, Peer.index, Peer.index, FrameData & 255])));
    }
    function Decoded() {
        return Sent.filter((S) => Relay.ParseHeader(S.Packet).Type === 3)
            .map((S) => {
                const Records = [];
                for (let At = 4; At < S.Packet.length; At += S.Packet.readUInt32LE(At)) {
                    if (S.Packet.readUInt32LE(At + 4) !== Input) continue;
                    Records.push(
                        ...Decode(S.Packet.subarray(At + 16, At + S.Packet.readUInt32LE(At)), Array(10).fill(1)),
                    );
                }
                return { ...S, Records };
            })
            .filter((S) => S.Records.length);
    }
    return {
        Router,
        Sent,
        Peers,
        Connect,
        Data,
        Input: InputData,
        Nak,
        Decoded,
        SetTime: (T) => {
            Now = T;
        },
        Pump: (T) => {
            Now = T;
            return Router.Pump();
        },
    };
}

Test('bursty input is released at 60 Hz, one complete multi-player tick per datagram', () => {
    const H = Harness();
    const A = H.Connect(1, 0),
        B = H.Connect(1, 1);
    H.Sent.length = 0;
    for (let FrameData = 0; FrameData < 90; FrameData++) {
        H.Input(A, FrameData);
        H.Input(B, FrameData);
    }
    Assert.equal(H.Decoded().length, 2, 'only frame zero can leave at time zero');
    for (let Ms = 1; Ms < 1000; Ms++) H.Pump(Ms);
    const Out = H.Decoded();
    Assert.equal(Out.length, 120);
    for (const Peer of [A, B]) {
        const Ticks = Out.filter((S) => S.Client.Port === Peer.port);
        Assert.deepEqual(
            Ticks.map((S) => S.Records[0].Frame),
            Array.from({ length: 60 }, (_, I) => I),
        );
        Assert.ok(Ticks.every((S) => S.Records.length === 2 && S.Records[0].Frame === S.Records[1].Frame));
        Assert.ok(Ticks.every((S) => S.Time + 0.0001 >= (S.Records[0].Frame * 1000) / 60));
        Assert.deepEqual(Ticks[0].Records[0].Bytes, Buffer.from('205300000000000000c04062a3', 'hex'));
    }
});

Test('uses native startup frame rate, rejects conflicting rates', () => {
    const H = Harness(2, 30);
    const A = H.Connect(1, 0),
        B = H.Connect(1, 1);
    for (let I = 0; I < 60; I++) {
        H.Input(A, I);
        H.Input(B, I);
    }
    for (let Ms = 1; Ms < 1000; Ms++) H.Pump(Ms);
    Assert.equal(H.Decoded().length, 60, '30 frames per player, not hardcoded 60');
    const Other = Harness();
    Other.Connect(1, 0);
    Assert.throws(() => Other.Connect(1, 1, 2, 30), /conflicting/);
});

Test('user-selected 75 Hz releases 75 complete ticks per second without changing native 60 Hz or frame zero', () => {
    const H = Harness(2, 60, 75);
    const A = H.Connect(1, 0),
        B = H.Connect(1, 1);
    for (let F = 0; F < 90; F++) {
        H.Input(A, F);
        H.Input(B, F);
    }
    for (let Ms = 1; Ms < 1000; Ms++) H.Pump(Ms);
    const Ticks = H.Decoded().filter((O) => O.Client.Port === A.port);
    Assert.equal(Ticks.length, 75);
    Assert.deepEqual(
        Ticks.map((O) => O.Records[0].Frame),
        Array.from({ length: 75 }, (_, I) => I),
    );
    Assert.ok(Ticks.every((O, I) => O.Time + 0.000001 >= (I * 1000) / 75));
    Assert.ok(Ticks.every((O) => O.Records.length === 2));
    Assert.equal(H.Router.LockstepDelay.Delay, 15);
    const Session = [...H.Router.Pacer.Sessions.values()][0];
    Assert.equal(Session.Rate, 75);
    Assert.equal(Session.NativeRate, 60);
    Assert.ok([...H.Router.Clients.values()].every((C) => C.Lockstep.Startup.readFloatBE(4) === 60));
    H.Nak(A, 89);
    Assert.equal(Session.Next, 75, 'future retransmit cannot accelerate the 75 Hz clock');
    H.Pump(10000);
    Assert.equal(Session.Next, 76, 'a stall cannot cause a 75 Hz catch-up burst');
    Assert.match(H.Router.Pacer.Summary(), /target 75 Hz/);
});

Test('runtime pacing defaults to 83 Hz / 12 frames with explicit native rollback and validation', () => {
    Assert.deepEqual(Relay.TimingOptions({}), { LockstepDelayFrames: 12, LockstepHz: 83 });
    Assert.equal(Relay.TimingOptions({ GRANITE_LOCKSTEP_BUFFER_FRAMES: '15' }).LockstepDelayFrames, 15);
    Assert.equal(Relay.TimingOptions({ OPAL_LOCKSTEP_DELAY_FRAMES: '0' }).LockstepDelayFrames, 0);
    Assert.deepEqual(Relay.TimingOptions({ OPAL_LOCKSTEP_DELAY_FRAMES: '15' }), {
        LockstepDelayFrames: 15,
        LockstepHz: 83,
    });
    Assert.equal(Relay.TimingOptions({ OPAL_LOCKSTEP_HZ: '0' }).LockstepHz, 0);
    Assert.equal(Relay.TimingOptions({ OPAL_LOCKSTEP_HZ: '60' }).LockstepHz, 60);
    for (const Hz of ['-1', '241', 'NaN', 'Infinity', '75.5']) {
        Assert.throws(() => Relay.TimingOptions({ OPAL_LOCKSTEP_HZ: Hz }), /OPAL_LOCKSTEP_HZ/);
    }
});

for (const Count of [2, 4, 6])
    Test(`83 Hz / 12-frame profile preserves frame zero for ${Count} players, one tick at a time`, () => {
        const H = Harness(Count, 60, 83, 12);
        const Peers = Array.from({ length: Count }, (_, Index) => H.Connect(1, Index));
        const A = Peers[0];
        for (let F = 0; F <= 12; F++) for (const Peer of Peers) H.Input(Peer, F);
        const Session = [...H.Router.Pacer.Sessions.values()][0];
        Assert.equal(Session.Next, 1);
        Assert.equal(Session.Pending.size, 12);
        let Produced = 12;
        for (let F = 1; F <= 830; F++) {
            H.Pump((F * 1000) / 83);
            Assert.equal(Session.Next, F + 1);
            Assert.equal(Session.Pending.size, 12 - (((F - 1) % 3) + 1));
            if (F % 3 === 0) {
                for (let I = 0; I < 3; I++) {
                    Produced++;
                    for (const Peer of Peers) H.Input(Peer, Produced);
                }
                Assert.equal(Session.Pending.size, 12);
            }
        }
        const Ticks = H.Decoded().filter((O) => O.Client.Port === A.port);
        Assert.equal(Ticks.length, 831);
        Assert.equal(Ticks.filter((O) => O.Time < 1000).length, 83);
        Assert.ok(Ticks.every((O, I) => O.Records.length === Count && O.Records.every((R) => R.Frame === (I & 255))));
        for (const Peer of Peers) {
            const Delivered = H.Decoded().filter((O) => O.Client.Port === Peer.port);
            Assert.equal(Delivered.length, Ticks.length, 'every participant receives every complete tick');
            Assert.ok(
                Delivered.every(
                    (O) => O.Records.length === Count && new Set(O.Records.map((R) => R.Machine)).size === Count,
                ),
            );
        }
        Assert.ok(Ticks.every((O, I) => !I || O.Time - Ticks[I - 1].Time >= 1000 / 83 - 0.000001));
        Assert.equal(Session.NativeRate, 60);
        Assert.ok([...H.Router.Clients.values()].every((C) => C.Lockstep.Startup.readFloatBE(4) === 60));
    });

Test('late tick cannot be followed immediately by the next tick on another drain', () => {
    const H = Harness(2, 60, 79, 10);
    const A = H.Connect(1, 0),
        B = H.Connect(1, 1),
        Period = 1000 / 79;
    for (let F = 0; F < 10; F++) {
        H.Input(A, F);
        H.Input(B, F);
    }
    H.Pump(2 * Period - 0.1);
    Assert.equal(H.Decoded().length, 4);
    H.Pump(2 * Period);
    Assert.equal(H.Decoded().length, 4, 'do not send a new tick 0.1 ms after the previous one');
    H.Nak(A, 2);
    Assert.equal(H.Decoded().length, 4);
    H.Pump(2 * Period - 0.1 + Period * 0.75);
    Assert.equal(H.Decoded().length, 6);
    Assert.equal([...H.Router.Pacer.Sessions.values()][0].Next, 3);
});

Test('18-frame native lookahead sustains 15..18 queued ticks at 75 Hz with three-input batches', () => {
    const H = Harness(2, 60, 75, 18);
    const A = H.Connect(1, 0),
        B = H.Connect(1, 1);
    for (let F = 0; F <= 18; F++) {
        H.Input(A, F);
        H.Input(B, F);
    }
    const Session = [...H.Router.Pacer.Sessions.values()][0];
    Assert.equal(Session.Next, 1);
    Assert.equal(Session.Pending.size, 18);
    Assert.equal(H.Decoded()[0].Records[0].Frame, 0);
    let Produced = 18;
    for (let F = 1; F <= 750; F++) {
        H.Pump((F * 1000) / 75);
        Assert.equal(Session.Next, F + 1);
        Assert.equal(Session.Pending.size, 18 - (((F - 1) % 3) + 1));
        if (F % 3 === 0) {
            for (let I = 0; I < 3; I++) {
                Produced++;
                H.Input(A, Produced);
                H.Input(B, Produced);
            }
            Assert.equal(Session.Pending.size, 18);
        }
    }
    const Ticks = H.Decoded().filter((O) => O.Client.Port === A.port);
    Assert.equal(Ticks.length, 751);
    Assert.ok(Ticks.every((O, I) => O.Records.length === 2 && O.Records.every((R) => R.Frame === (I & 255))));
    Assert.equal(Session.NativeRate, 60);
});

Test('requires all roster inputs and never catches up in a burst after a stalled peer or clock', () => {
    const H = Harness();
    const A = H.Connect(1, 0),
        B = H.Connect(1, 1);
    for (let F = 0; F < 20; F++) H.Input(A, F);
    H.Pump(5000);
    Assert.equal(H.Decoded().length, 0);
    for (let F = 0; F < 20; F++) H.Input(B, F);
    Assert.equal(H.Decoded().length, 2);
    H.Pump(10000);
    H.Pump(10000);
    Assert.equal(H.Decoded().length, 4, 'one tick, not 300 catch-up ticks');
    H.Pump(10016);
    Assert.equal(H.Decoded().length, 4);
    H.Pump(10017);
    Assert.equal(H.Decoded().length, 6);
});

Test('future NAKs and duplicate inputs cannot bypass the clock; past NAKs still retransmit', () => {
    const H = Harness();
    const A = H.Connect(1, 0),
        B = H.Connect(1, 1);
    for (let F = 0; F < 10; F++) {
        H.Input(A, F);
        H.Input(B, F);
    }
    H.Sent.length = 0;
    H.Nak(A, 9);
    H.Input(A, 0);
    H.Input(B, 0);
    Assert.equal(H.Decoded().length, 0);
    H.Nak(A, 0);
    Assert.equal(H.Decoded().length, 2);
    Assert.ok(H.Decoded().every((D) => D.Records[0].Frame === 0 && D.Client.Port === A.port));
    Assert.equal([...H.Router.Pacer.Sessions.values()][0].Next, 1);
});

Test('frame-byte wrap preserves monotonic tick numbers and ordering over a long match', () => {
    const H = Harness();
    const A = H.Connect(1, 0),
        B = H.Connect(1, 1);
    for (let F = 0; F < 900; F++) {
        H.SetTime(Math.ceil((F * 1000) / 60));
        H.Input(A, F);
        H.Input(B, F);
    }
    const Rows = H.Decoded().filter((D) => D.Client.Port === A.port);
    Assert.equal(Rows.length, 900);
    Assert.ok(Rows.every((D, I) => D.Records.every((R) => R.Frame === (I & 255))));
    Assert.equal([...H.Router.Pacer.Sessions.values()][0].Next, 900);
});

Test('100 simultaneous match clocks are isolated; a missing player blocks only their match', () => {
    const H = Harness();
    for (let Room = 1; Room <= 100; Room++) {
        const A = H.Connect(Room, 0),
            B = H.Connect(Room, 1);
        H.Input(A, 0);
        if (Room !== 50) H.Input(B, 0);
    }
    Assert.equal(H.Decoded().length, 198);
    Assert.equal(H.Router.Pacer.Sessions.size, 100);
    for (const Row of H.Decoded()) {
        const SourceIds = [];
        for (let At = 4; At < Row.Packet.length; At += Row.Packet.readUInt32LE(At))
            SourceIds.push(Row.Packet.readBigUInt64LE(At + 8));
        const Recipient = H.Peers.find((P) => P.port === Row.Client.Port);
        Assert.ok(SourceIds.every((Id) => H.Peers.find((P) => P.Machine === Id).Room === Recipient.Room));
    }
});

Test('disconnect removes queued clock data; expired endpoints cannot receive delayed sends', () => {
    const H = Harness();
    const A = H.Connect(1, 0),
        B = H.Connect(1, 1);
    for (let I = 0; I < 5; I++) {
        H.Input(A, I);
        H.Input(B, I);
    }
    H.Sent.length = 0;
    const Disconnect = Buffer.alloc(12);
    Disconnect.writeUInt32BE(Relay.BuildHeader(2, 0, 12, 0));
    Disconnect.writeBigUInt64BE(B.Machine, 4);
    H.Router.Handle(Disconnect, B);
    H.Pump(1000);
    Assert.equal(H.Decoded().length, 0);
    Assert.equal(H.Router.Pacer.Sessions.size, 0);
    H.Pump(80000);
    Assert.equal(H.Router.Clients.size, 0);
});

Test('ordinary application traffic remains immediate while input is queued', () => {
    const H = Harness();
    const A = H.Connect(1, 0);
    H.Connect(1, 1);
    H.Input(A, 0);
    H.Sent.length = 0;
    const Message = Frame(0x12345678, A.Machine, Buffer.from('opaque'));
    H.Data(A, Message);
    Assert.equal(H.Sent.length, 2);
    Assert.ok(H.Sent.every((O) => O.Packet.subarray(4).equals(Message)));
});

Test('live UDP timer releases queued ticks without needing more inbound packets', async (T) => {
    const Dgram = require('node:dgram');
    const { once: Once } = require('node:events');
    const Saved = process.env.OPAL_LOCKSTEP_DELAY_FRAMES;
    process.env.OPAL_LOCKSTEP_DELAY_FRAMES = '15';
    const Socket = Relay.Start({ port: 0, host: '127.0.0.1' });
    const Clients = [Dgram.createSocket('udp4'), Dgram.createSocket('udp4')];
    T.after(() => {
        Clients.forEach((C) => C.close());
        Relay.Stop();
        if (Saved === undefined) delete process.env.OPAL_LOCKSTEP_DELAY_FRAMES;
        else process.env.OPAL_LOCKSTEP_DELAY_FRAMES = Saved;
    });
    await Once(Socket, 'listening');
    const Port = Socket.address().port;
    async function Send(Client, Packet) {
        await new Promise((Resolve, Reject) =>
            Client.send(Packet, Port, '127.0.0.1', (E) => (E ? Reject(E) : Resolve())),
        );
    }
    const Received = [[], []];
    let Finish;
    const Done = new Promise((Resolve) => {
        Finish = Resolve;
    });
    const Timer = setTimeout(() => Finish(false), 2000);
    T.after(() => clearTimeout(Timer));
    for (let Index = 0; Index < 2; Index++) {
        const Client = Clients[Index],
            Machine = BigInt(100 + Index);
        const Connect = Buffer.alloc(28, 1);
        Connect.writeUInt32BE(Relay.BuildHeader(0, 0, 28, 0));
        Connect.writeBigUInt64BE(Machine, 20);
        const Reply = Once(Client, 'message');
        await Send(Client, Connect);
        await Reply;
        Client.on('message', (Packet) => {
            if (Packet.length < 22 || Packet.readUInt32LE(8) !== Input) return;
            const Second = 4 + Packet.readUInt32LE(4);
            Assert.ok(Second + 16 < Packet.length);
            Assert.deepEqual([Packet.readBigUInt64LE(12), Packet.readBigUInt64LE(Second + 8)], [100n, 101n]);
            Received[Index].push(Packet[21]);
            if (Received.every((Frames) => Frames.length >= 3)) Finish(true);
        });
        function Wrap(Payload) {
            const Packet = Buffer.alloc(Payload.length + 4);
            Packet.writeUInt32BE(Relay.BuildHeader(3, 3, Packet.length, 0));
            Payload.copy(Packet, 4);
            return Packet;
        }
        const StartupBody = Buffer.from('00010301427000006001010000000000000000', 'hex');
        StartupBody[0] = Index;
        await Send(Client, Wrap(Frame(Startup, Machine, StartupBody)));
        for (let F = 0; F < 3; F++) {
            const Body = Buffer.concat([
                Buffer.from([Index << 4, (F - 15) & 255]),
                Buffer.from('205300000000000000c04062a3', 'hex'),
            ]);
            await Send(Client, Wrap(Frame(Input, Machine, Body)));
        }
    }
    Assert.equal(await Done, true, 'pacing timer should release the remaining two ticks');
    Assert.deepEqual(Received, [
        [0, 1, 2],
        [0, 1, 2],
    ]);
});
