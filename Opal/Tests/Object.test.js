// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Assert = require('assert');
const Fs = require('fs');
const Path = require('path');
const Obj = require('../Source/Codec/ObjectFrame');

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

const Frames = Path.join(__dirname, 'Frames');
const Load = (Name) => Fs.readFileSync(Path.join(Frames, Name));
const Ws13 = Load('Ws13BinaryF0Op9C72247C.bin');
const Ws8 = Load('Ws8BinaryF0Op9C72247C.bin');
const Ws35 = Load('Ws35BinaryF0Op9C72247C.bin');

Test('the 2k26 layout is detected from the frame itself', () => {
    const Layout = Obj.DetectLayout(Ws13);
    Assert.strictEqual(Layout, Obj.Layout.TwentySix, '2k26 carries an eight byte sequence that 2k21 does not');
});

Test('a captured court frame parses and its declared length closes exactly', () => {
    const Parsed = Obj.Parse(Ws13);
    Assert.strictEqual(Parsed.ClassName, 'COURT');
    Assert.strictEqual(Parsed.PayloadLength, 1242);
    Assert.strictEqual(Parsed.Layout.Payload + Parsed.PayloadLength, Ws13.length);
});

Test('the body key echoes the object id', () => {
    for (const [Name, Bytes] of [
        ['ws13', Ws13],
        ['ws8', Ws8],
        ['ws35', Ws35],
    ]) {
        const Parsed = Obj.Parse(Bytes);
        Assert.ok(Parsed, `${Name} parses`);
        Assert.strictEqual(Parsed.Key, Parsed.ObjectId, `${Name} key echoes object id`);
    }
});

Test('versions differ between captures of the same court', () => {
    Assert.strictEqual(Obj.Parse(Ws13).Version, 9489n);
    Assert.strictEqual(Obj.Parse(Ws8).Version, 8424n);
    Assert.strictEqual(Obj.Parse(Ws13).ObjectId, 0x00357a690000612en);
});

Test('the flag bitmap decodes to a plausible field set', () => {
    const A = Obj.Parse(Ws13);
    const B = Obj.Parse(Ws8);
    Assert.strictEqual(
        A.FlagCount,
        148,
        'these fixtures are 2K26 frames and they set bit 147; 2K21 courts have 147 bits ' +
            'and are built in Courts.js',
    );
    Assert.strictEqual(A.Flags.length, 72);
    Assert.strictEqual(B.Flags.length, 71);

    const Shared = A.Flags.filter((Bit) => B.Flags.includes(Bit));
    Assert.ok(Shared.length >= 70, `expected the two snapshots to share most fields, shared ${Shared.length}`);
    Assert.ok(A.Flags.every((Bit) => Bit >= 0 && Bit < 148));
});

Test('the values region is what is left after the bitmap', () => {
    const Parsed = Obj.Parse(Ws13);
    const Expected = Parsed.PayloadLength - Obj.Body.Flags - Obj.FlagBytes(Parsed.FlagCount);
    Assert.strictEqual(Parsed.Values.length, Expected);
    Assert.strictEqual(Parsed.Values.length, 1207);
});

Test('an unknown class still yields an envelope, without a field walk', () => {
    const Parsed = Obj.Parse(Ws35);
    Assert.strictEqual(Parsed.ClassName, '0x1BDBD519', 'class name not recovered');
    Assert.strictEqual(Parsed.FlagCount, null);
    Assert.strictEqual(Parsed.Values, null, 'no flag count means no safe split');
    Assert.strictEqual(Parsed.Key, Parsed.ObjectId, 'envelope still readable');
});

Test('flags round trip through write and read', () => {
    const Bits = [0, 7, 8, 11, 63, 147];
    const Bytes = Obj.WriteFlags(Bits, 148);
    Assert.strictEqual(Bytes.length, 19, 'ceil(148 / 8)');
    Assert.deepStrictEqual(Obj.ReadFlags(Bytes, 0, 148), Bits);
});

Test('bits run most significant first inside each byte', () => {
    Assert.deepStrictEqual([...Obj.WriteFlags([0], 8)], [0x80]);
    Assert.deepStrictEqual([...Obj.WriteFlags([7], 8)], [0x01]);
    Assert.deepStrictEqual([...Obj.WriteFlags([0, 7], 8)], [0x81]);
});

Test('a flag outside the class is refused rather than silently wrapped', () => {
    Assert.throws(() => Obj.WriteFlags([148], 148), /outside/);
});

Test('a value offset is the sum of the sizes of every earlier present field', () => {
    const Player = Obj.ClassOf(0x2c5d2702);
    Assert.strictEqual(Obj.ValueOffset([0, 1, 4], 0, Player.Sizes), 0);
    Assert.strictEqual(Obj.ValueOffset([0, 1, 4], 1, Player.Sizes), 8);
    Assert.strictEqual(Obj.ValueOffset([0, 1, 4], 4, Player.Sizes), 16);
    Assert.strictEqual(Obj.ValueOffset([1, 4], 4, Player.Sizes), 8);
    Assert.strictEqual(Obj.ValueOffset([1, 4], 0, Player.Sizes), -1, 'absent field has no offset');
});

Test('a class with no size table reports no offsets rather than guessing', () => {
    Assert.strictEqual(Obj.ClassOf(0x2c4d49e3).Sizes, null, 'court sizes are not recovered');
    Assert.strictEqual(Obj.ValueOffset([0, 1], 1, null), -1);
    Assert.strictEqual(Obj.ReadValue(Obj.Parse(Ws13), 0), null);
});

Test('a built object frame parses back to what went in', () => {
    const Payload = Obj.BuildPayload({
        key: 0x00357a690000612en,
        version: 42n,
        ClassCrc: 0x2c5d2702,
        Bits: [0, 1, 4],
        Values: Buffer.alloc(8 + 8 + 4, 0xee),
    });
    const Frame = Obj.Build({
        PacketId: 0x9c72247c,
        ConnectionId: Buffer.alloc(8),
        ObjectId: 0x00357a690000612en,
        ClassCrc: 0x2c5d2702,
        Payload,
        Layout: Obj.Layout.TwentyOne,
    });

    const Parsed = Obj.Parse(Frame, Obj.Layout.TwentyOne);
    Assert.strictEqual(Parsed.ClassName, 'PLAYER');
    Assert.strictEqual(Parsed.Key, 0x00357a690000612en);
    Assert.strictEqual(Parsed.Version, 42n);
    Assert.deepStrictEqual(Parsed.Flags, [0, 1, 4]);
    Assert.strictEqual(Parsed.Values.length, 20);
    Assert.strictEqual(Frame.readUInt32LE(0), Frame.length, 'declared length closes');
});

Test('a built player field can be read back at its computed offset', () => {
    const Values = Buffer.concat([Buffer.alloc(8, 0x11), Buffer.alloc(8, 0x22), Buffer.alloc(4, 0x33)]);
    const Payload = Obj.BuildPayload({
        key: 1n,
        version: 1n,
        ClassCrc: 0x2c5d2702,
        Bits: [0, 1, 4],
        Values,
    });
    const Frame = Obj.Build({
        PacketId: 0x9c72247c,
        ConnectionId: null,
        ObjectId: 1n,
        ClassCrc: 0x2c5d2702,
        Payload,
        Layout: Obj.Layout.TwentyOne,
    });
    const Parsed = Obj.Parse(Frame, Obj.Layout.TwentyOne);
    Assert.deepStrictEqual(Obj.ReadValue(Parsed, 0), Buffer.alloc(8, 0x11));
    Assert.deepStrictEqual(Obj.ReadValue(Parsed, 1), Buffer.alloc(8, 0x22));
    Assert.deepStrictEqual(Obj.ReadValue(Parsed, 4), Buffer.alloc(4, 0x33));
});

process.stdout.write(`\n${Passed} passing\n`);
