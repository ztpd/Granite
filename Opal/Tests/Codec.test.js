// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Assert = require('assert');
const { Crc32, Hex } = require('../Source/Core/Crc32');
const Names = require('../Source/Core/Names');
const Frame = require('../Source/Codec/Frame');
const FieldList = require('../Source/Codec/FieldList');
const Packets = require('../Source/Protocol/Packets');
const Samples = require('./Samples');

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

Test('constants derive from crc32 of their engine name', () => {
    Assert.strictEqual(Crc32('LOCATION'), 0x98ad1587);
    Assert.strictEqual(Crc32('NAME'), 0x68b693b2);
    Assert.strictEqual(Crc32('URL'), 0x62d10724);
    Assert.strictEqual(Crc32('PLATFORM'), 0xff614c87);
    Assert.strictEqual(Crc32('MATCH_ID'), 0xd4c0767a);
});

Test('player server states resolve, and the stale vcutils values do not', () => {
    Assert.strictEqual(Crc32('WALKING'), 0x9705bb0d);
    Assert.strictEqual(Crc32('GOT_NEXT'), 0xca9b2162);
    Assert.strictEqual(Crc32('PLAYING'), 0xecbccdf8);
    Assert.strictEqual(Names.Resolve(0x96f4174d), null, 'vcutils EMPTY must not resolve');
    Assert.strictEqual(Names.Resolve(0xcaa10ae2), null, 'vcutils GOT_NEXT must not resolve');
});

Test('crc names display in pascal case', () => {
    Assert.strictEqual(Names.Describe(0xd4c0767a), 'MatchId');
    Assert.strictEqual(Names.Describe(0x27efd460), 'MatchType');
    Assert.strictEqual(Names.Describe(0x8f639d27), 'WorldVersion');
    Assert.strictEqual(Names.Describe(0x5f496877), '0x5F496877', 'unrecovered stays hex');
});

const Movement = Samples.Movement;

Test('movement frame parses and is well formed', () => {
    const FrameData = Frame.Parse(Movement);
    Assert.strictEqual(FrameData.PacketId, 0xce1c9e8c);
    Assert.strictEqual(FrameData.Length, 30);
    Assert.ok(Frame.IsWellFormed(FrameData));
    Assert.strictEqual(Packets.InCode(FrameData.PacketId), 0x8c9e1cce);
});

Test('movement body decodes to a walking player in cages', () => {
    Assert.strictEqual(Movement.readInt16BE(16) * 3, -537);
    Assert.strictEqual(Movement.readInt16BE(18), 0);
    Assert.strictEqual(Movement.readInt16BE(20) * 3, 56544);
    Assert.strictEqual(Movement.readUInt8(22), 0x83, 'heading is +22, not +23');
    Assert.strictEqual(Movement.readUInt32BE(23) >>> 0, 0xfc9797cf, 'cages activity key');
});

const Connect = Samples.Connect;

Test('connect frame is identified by packet id', () => {
    const FrameData = Frame.Parse(Connect);
    Assert.strictEqual(FrameData.PacketId, 0x9d32c5b4);
    Assert.strictEqual(Packets.EngineName(FrameData.PacketId), 'TK_WORLD::SERVER::Connect');
});

Test('connect field list parses to 27 fields with the data section at 464', () => {
    const List = FieldList.Parse(Connect, Frame.HeaderSize);
    Assert.strictEqual(List.Fields.length, 27);
    Assert.strictEqual(List.DataOffset, 464);
});

Test('connect fields are in ascending crc order, as the client binary search requires', () => {
    const List = FieldList.Parse(Connect, Frame.HeaderSize);
    for (let I = 1; I < List.Fields.length; I++) {
        Assert.ok(List.Fields[I].Crc > List.Fields[I - 1].Crc, `field ${I} ${Hex(List.Fields[I].Crc)} breaks ordering`);
    }
});

Test('connect carries the server url as a string reference', () => {
    const List = FieldList.Parse(Connect, Frame.HeaderSize);
    const Url = FieldList.Find(List, 'URL');
    Assert.ok(Url, 'URL field present');
    Assert.strictEqual(FieldList.ReadString(List, Url), 'wss://127.0.0.1:20054/');
});

Test('connect names resolve to the values we expect', () => {
    const List = FieldList.Parse(Connect, Frame.HeaderSize);
    Assert.strictEqual(FieldList.Find(List, 'LOCATION').Data1 >>> 0, 0x19b63986, 'boulevard');
    Assert.strictEqual(FieldList.Find(List, 'WORLD_TYPE').Data1 >>> 0, 0xcd23d3f3, 'park server type');
    Assert.strictEqual(FieldList.Find(List, 'WORLD_VERSION').Value, 119n);
    Assert.strictEqual(FieldList.Find(List, 'MATCH_TYPE').Value, 0x0110000103b57f79n);
});

const Compressed = Samples.Compressed;

Test('compressed command frame uses the object inner header', () => {
    const FrameData = Frame.Parse(Compressed);
    Assert.strictEqual(FrameData.PacketId, 0x9e3471ed);
    const Inner = Frame.ReadInnerHeader(Compressed, Frame.InnerHeader.Object);
    Assert.strictEqual(Inner.ObjectId, 0n);
    Assert.strictEqual(Inner.PayloadLength, 0x0aa8);
    Assert.strictEqual(Inner.BodyOffset, 28);
});

Test('compressed command carries CompressedData plus a Userdata command', () => {
    const List = FieldList.Parse(Compressed, 28);
    Assert.strictEqual(List.Fields.length, 2);
    Assert.strictEqual(List.DataOffset, 76, 'terminator at 60 then 16 bytes');
    Assert.strictEqual(Names.Describe(List.Fields[0].Crc), 'CompressedData');
    Assert.strictEqual(List.Fields[0].Data2, 2675);
    const Command = FieldList.Find(List, 'COMMAND');
    Assert.strictEqual(Names.Describe(Command.Data1), 'Userdata');
});

Test('builder emits crc sorted records that parse back identically', () => {
    const Body = new FieldList.Builder()
        .AddU32('WORLD_TYPE', 0xcd23d3f3)
        .AddU32('LOCATION', 0x19b63986)
        .AddU64('MATCH_ID', 0x0110000103b57f79n)
        .AddString('URL', 'wss://127.0.0.1:20054/')
        .Build();

    const FrameData = Frame.Build(0x9d32c5b4, Buffer.alloc(8), Body, Frame.InnerHeader.None);
    const Parsed = Frame.Parse(FrameData);
    Assert.ok(Frame.IsWellFormed(Parsed), 'declared length matches actual');

    const List = FieldList.Parse(FrameData, Frame.HeaderSize);
    Assert.strictEqual(List.Fields.length, 4);
    for (let I = 1; I < List.Fields.length; I++) {
        Assert.ok(List.Fields[I].Crc > List.Fields[I - 1].Crc, 'builder output stays sorted');
    }
    Assert.strictEqual(FieldList.Find(List, 'LOCATION').Data1 >>> 0, 0x19b63986);
    Assert.strictEqual(FieldList.Find(List, 'MATCH_ID').Value, 0x0110000103b57f79n);
    Assert.strictEqual(FieldList.ReadString(List, FieldList.Find(List, 'URL')), 'wss://127.0.0.1:20054/');
});

Test('packet ids derive from crc32 of the packet name, byteswapped', () => {
    Assert.strictEqual(Packets.Wire('OBJECT_DATA') >>> 0, 0x9c72247c);
    Assert.strictEqual(Packets.Wire('OBJECT_UPDATE') >>> 0, 0x01ae543f);
    Assert.strictEqual(Packets.Wire('OBJECT_DATA_LIST') >>> 0, 0x771f7646);
    Assert.strictEqual(Packets.Wire('OBJECT_UPDATE_LIST') >>> 0, 0x618ec78c);
    Assert.strictEqual(Packets.Wire('REQUEST_ACK') >>> 0, 0x2b84ffc2);
    Assert.strictEqual(Packets.Wire('HELLO') >>> 0, 0x366444c1);
    Assert.strictEqual(Packets.Wire('COMMAND') >>> 0, 0xce148fb1, 'match request');
});

Test('the real heartbeat is 0x36F3BF4E, not the movement packet', () => {
    Assert.strictEqual(Packets.Wire('HEARTBEAT') >>> 0, 0x36f3bf4e);
    const MovementValue = Packets.Lookup(0xce1c9e8c);
    Assert.strictEqual(MovementValue.Name, null, 'movement has no recovered name');
    Assert.match(MovementValue.Note, /misname it HEARTBEAT/);
});

process.stdout.write(`
`);

process.stdout.write(`
`);

process.stdout.write(`
`);

Test('a reference that overruns the buffer says so instead of stating its size', () => {
    const Truncated = Samples.AsStandalone(Samples.Compressed);
    const Inner = Frame.ReadInnerHeader(Truncated, Frame.InnerHeader.Object);
    Assert.strictEqual(Inner.Complete, false, 'the sample is a truncated capture');
    Assert.strictEqual(Inner.PayloadLength, 2728);
    Assert.strictEqual(Inner.Shortfall, 2728 - Inner.Available);

    const List = FieldList.Parse(Truncated, Inner.BodyOffset);
    const Rendered = FieldList.Format(List);
    Assert.match(
        Rendered,
        /2675 bytes declared, \d+ missing/,
        'the declared size alone would be a claim the frame does not support',
    );
    Assert.strictEqual(FieldList.ReadBlob(List, List.Fields[0]).length, 0, 'and reading is refused');
});

Test('a complete frame reports its sizes plainly', () => {
    const BlobData = Buffer.alloc(64, 0x78);
    const Body = new FieldList.Builder().AddBlob('COMPRESSED_DATA', BlobData).AddU32('COMMAND', 0xcdbd175e).Build();
    const FrameData = Frame.Build(0x9e3471ed, Buffer.alloc(8), Body, Frame.InnerHeader.Object);

    const Inner = Frame.ReadInnerHeader(FrameData, Frame.InnerHeader.Object);
    Assert.strictEqual(Inner.Complete, true);
    Assert.strictEqual(Inner.Shortfall, 0);

    const List = FieldList.Parse(FrameData, Inner.BodyOffset);
    Assert.match(FieldList.Format(List), /CompressedData is 64 bytes/);
    Assert.deepStrictEqual(FieldList.ReadBlob(List, List.Fields[0]), BlobData);
});

process.stdout.write(`
${Passed} passing
`);
