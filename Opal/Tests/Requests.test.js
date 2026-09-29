// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Assert = require('assert');
const Log = require('../Source/Core/Log');
const Requests = require('../Source/Protocol/Requests');
const Packets = require('../Source/Protocol/Packets');
const Frame = require('../Source/Codec/Frame');
const { Connection } = require('../Source/Protocol/Connection');

Log.SetLevel(Log.Level.Error);

let Passed = 0;
function Test(Name, Fn) {
    try {
        Fn();
        Passed++;
        process.stdout.write(`\x1b[38;5;39m  pass  ${Name}\x1b[0m\n`);
    } catch (E) {
        process.stdout.write(`\x1b[38;5;203m  FAIL  ${Name}\n        ${E.message}\x1b[0m\n`);
        process.exitCode = 1;
    }
}

const Socket = (Sink) => ({
    destroyed: false,
    write: (B) => Sink.push(B),
    destroy() {
        this.destroyed = true;
    },
});

function Payload(Wrapped) {
    return Wrapped.slice(Wrapped.length - 24);
}

Test('the frame is a well formed request ack', () => {
    const FrameData = Requests.Build(1);
    Assert.strictEqual(FrameData.length, 24, 'the 2K21 shape, as Sulfur sends it');
    Assert.strictEqual(FrameData.readUInt32LE(0), FrameData.length, 'declared length closes');
    Assert.strictEqual(FrameData.readUInt32BE(4) >>> 0, Packets.Wire('REQUEST_ACK'));
    Assert.strictEqual(FrameData.readBigUInt64BE(8), 0n, 'connection id is zero');
    Assert.strictEqual(FrameData.readBigUInt64BE(16), 1n, 'the request id');
    Assert.ok(Frame.IsWellFormed(Frame.Parse(FrameData)));
});

Test('every id in the range gets its own frame, and the ids are distinct', () => {
    const Sent = [];
    const C = new Connection(Socket(Sent), {}, 20054);
    const Count = Requests.AckAll(C);

    Assert.strictEqual(Count, Requests.HighestId);
    Assert.strictEqual(Sent.length, Requests.HighestId);

    const Ids = Sent.map((B) => Payload(B).readBigUInt64BE(16));
    Assert.deepStrictEqual(
        Ids,
        Ids.map((_, I) => BigInt(I + 1)),
        'ids run from one, in order, with no repeats',
    );
});

Test('starting twice does not stack a second timer', () => {
    const Sent = [];
    const C = new Connection(Socket(Sent), {}, 20054);

    Requests.Start(C);
    const Timer = C.AckTimer;
    Assert.ok(Timer, 'the first start armed a timer');
    const AfterFirst = Sent.length;

    Requests.Start(C);
    Assert.strictEqual(C.AckTimer, Timer, 'the same timer is still the one running');
    Assert.strictEqual(Sent.length, AfterFirst, 'and no second burst went out');

    Requests.Stop(C);
    Assert.strictEqual(C.AckTimer, null);
});

Test('closing a connection cancels its acks', () => {
    const Sent = [];
    const C = new Connection(Socket(Sent), {}, 20054);
    Requests.Start(C);
    Assert.ok(C.AckTimer);

    C.Close('test');
    Assert.strictEqual(C.AckTimer, null, 'a timer left running would keep acking a player who has left');
});

Test('stopping something that was never started is harmless', () => {
    const C = new Connection(Socket([]), {}, 20054);
    Requests.Stop(C);
    Assert.strictEqual(C.AckTimer, null);
});

process.stdout.write(`\n${Passed} passing\n`);
