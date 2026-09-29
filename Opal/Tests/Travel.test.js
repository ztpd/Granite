// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Assert = require('assert');
const { Crc32 } = require('../Source/Core/Crc32');
const { Crc } = require('../Source/Core/Names');
const FieldList = require('../Source/Codec/FieldList');
const Frame = require('../Source/Codec/Frame');
const Worlds = require('../Source/Protocol/Worlds');
const ChangeServer = require('../Source/Protocol/ChangeServer');
const { OnTravelRequest } = require('../Source/Protocol/Connection');

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

Test('every world table entry is crc32 of its own name, in index order', () => {
    Assert.strictEqual(Worlds.Table.length, 16);
    const Expected = [
        0x4905ed7b, 0x19b63986, 0x32838485, 0x1d389fb9, 0xaa9a8630, 0x7eb406e1, 0xf2754bab, 0xef69ed2a, 0xc9edd6b7,
        0xf771f34e, 0x3aa40b83, 0xaa078173, 0x7da84f70, 0xc31f074b, 0xccfac817, 0x55552c6b,
    ];
    Expected.forEach((Value, Index) => {
        Assert.strictEqual(Worlds.Keys[Index] >>> 0, Value >>> 0, `index ${Index} (${Worlds.Table[Index]})`);
    });
});

Test('server type names are the engine names, not the community ones', () => {
    Assert.strictEqual(Worlds.ServerType.World, Crc32('WORLD'), 'neighborhood is WORLD');
    Assert.strictEqual(Worlds.ServerType.World >>> 0, 0xcd23d3f3);
    Assert.strictEqual(Worlds.ServerType.Park, Crc32('PARK'), 'the stage is PARK');
    Assert.strictEqual(Worlds.ServerType.Park >>> 0, 0xf2929087);
    Assert.strictEqual(Worlds.ServerType.MyCourt >>> 0, 0xc1e9be6a);
});

Test('activity keys derive from the lowercase world name', () => {
    Assert.strictEqual(Worlds.ActivityFor(Crc('GAMBLING')) >>> 0, 0xdb0b03f5);
    Assert.strictEqual(Worlds.ActivityFor(Crc('SLAMBALL')) >>> 0, 0xfc9797cf);
    Assert.strictEqual(Worlds.ActivityFor(Crc('BOULEVARD')) >>> 0, 0x3cf672c2);
    Assert.notStrictEqual(0x3cf672c2, Crc32('boulevard'));
});

Test('index 0 and unknown keys are refused before a packet is built', () => {
    Assert.throws(() => Worlds.AssertRoutable(Crc('NONE')), /index 0/);
    Assert.throws(() => Worlds.AssertRoutable(0xdeadbeef), /not in the client/);
    Assert.strictEqual(Worlds.AssertRoutable(Crc('GAMBLING')), 3);
    Assert.strictEqual(Worlds.AssertRoutable(Crc('SLAMBALL')), 10);
    Assert.strictEqual(Worlds.AssertRoutable(Crc('CRIB')), 5);
});

Test('change server frame carries the documented body layout', () => {
    const Built = ChangeServer.Build({
        SessionId: 0x0110000103b57f79n,
        ServerType: Worlds.ServerType.Park,
        WorldKey: Crc('GAMBLING'),
        url: 'wss://127.0.0.1:20054/',
        ConnectionId: Buffer.from('fa68000000000000', 'hex'),
    });

    const FrameData = Frame.Parse(Built.Frame);
    Assert.strictEqual(FrameData.PacketId, 0x9ffcdad0, 'wire id, not the sub-opcode');
    Assert.ok(Frame.IsWellFormed(FrameData));
    Assert.strictEqual(Built.Frame.length, 16 + ChangeServer.BodyLength);
    Assert.strictEqual(
        ChangeServer.BodyLength,
        ChangeServer.Offset.Url + ChangeServer.RouteWindowLength,
        'the native handler copies all 1024 bytes at +226',
    );
    Assert.strictEqual(Built.WorldName, 'GAMBLING');
    Assert.strictEqual(Built.WorldIndex, 3);

    const Body = Built.Frame.slice(Frame.HeaderSize);
    Assert.strictEqual(Body.readUInt32BE(0) >>> 0, 0x86073f8c, 'sub-opcode at body+0');
    Assert.strictEqual(Body.readBigUInt64BE(4), 0x0110000103b57f79n);
    Assert.strictEqual(Body.readUInt32BE(28) >>> 0, 0xf2929087);
    Assert.strictEqual(Body.readUInt32BE(176) >>> 0, Crc('GAMBLING'));
    Assert.strictEqual(
        Body.length - ChangeServer.Offset.Url,
        1024,
        'the client must never read beyond the received body',
    );
});

Test('spectator connect is an ordinary connect body with the START_SPECTATOR sub-opcode', () => {
    Assert.strictEqual(ChangeServer.SpectatorSubOpcode >>> 0, 0xb0bf29b0);
    Assert.strictEqual(ChangeServer.SpectatorSubOpcode >>> 0, Crc32('START_SPECTATOR') >>> 0);

    const Args = {
        SessionId: 0x0110000103b57f79n,
        ServerType: Worlds.ServerType.World,
        WorldKey: Crc('BOULEVARD'),
        url: 'wss://127.0.0.1:20054/',
        ConnectionId: Buffer.from('fa68000000000000', 'hex'),
    };
    const Spectate = ChangeServer.BuildSpectator(Args);
    const Connect = ChangeServer.Build(Args);

    const FrameData = Frame.Parse(Spectate.Frame);
    Assert.strictEqual(FrameData.PacketId, 0x9ffcdad0, 'wire id, not the sub-opcode');
    Assert.ok(Frame.IsWellFormed(FrameData));
    Assert.strictEqual(
        Spectate.Frame.length,
        Connect.Frame.length,
        'spectator body is the same size as an ordinary connect',
    );

    const Body = Spectate.Frame.slice(Frame.HeaderSize);
    Assert.strictEqual(Body.readUInt32BE(0) >>> 0, 0xb0bf29b0, 'spectator sub-opcode at body+0');
    Assert.strictEqual(Body.readBigUInt64BE(4), Args.SessionId, 'the game match id rides at body+4');
    Assert.strictEqual(Body.readUInt32BE(176) >>> 0, Crc('BOULEVARD'));

    const ConnectBody = Connect.Frame.slice(Frame.HeaderSize);
    Assert.ok(Body.slice(4).equals(ConnectBody.slice(4)), 'spectator and connect bodies differ only at the sub-opcode');
});

Test('url sits at native 2K19 body+226 and the ticket follows it', () => {
    const Url = 'wss://127.0.0.1:20054/';
    const Built = ChangeServer.Build({
        SessionId: 1n,
        ServerType: Worlds.ServerType.MyCourt,
        WorldKey: Crc('CRIB'),
        url: Url,
    });
    const Body = Built.Frame.slice(Frame.HeaderSize);
    const End = Body.indexOf(0, ChangeServer.Offset.Url);
    Assert.strictEqual(Body.slice(ChangeServer.Offset.Url, End).toString('utf8'), Url);

    const TicketLength = Body.readUInt16BE(ChangeServer.Offset.TicketLength);
    const TicketOffset = ChangeServer.Offset.Url + Url.length + 1;
    const Ticket = Body.slice(TicketOffset, TicketOffset + TicketLength);
    const List = FieldList.Parse(Ticket, 0);
    Assert.strictEqual(List.Fields.length, 6);
    for (let I = 1; I < List.Fields.length; I++) {
        Assert.ok(
            List.Fields[I].Crc > List.Fields[I - 1].Crc,
            'ticket must be crc sorted or the client binary search mis-reads it',
        );
    }
    Assert.strictEqual(FieldList.Find(List, 'LOCATION').Data1 >>> 0, Crc('CRIB'));
    Assert.strictEqual(FieldList.Find(List, 'MATCH_ID').Value, 1n);
});

Test('travel requests are detected by field, and the handshake never is', () => {
    const Body = new FieldList.Builder()
        .AddU64('MATCH_TYPE', 0xa91b4ef87f821cd9n)
        .AddU32('COMMAND', ChangeServer.StartConnection)
        .AddU32('LOCATION', Crc('SLAMBALL'))
        .AddU64('PUID', 0x0110000100000666n)
        .Build();
    const Travel = Frame.Build(0xce148fb1, Buffer.alloc(8), Body, Frame.InnerHeader.None);

    Assert.ok(ChangeServer.IsTravelRequest(Travel, 0xce148fb1));
    Assert.ok(!ChangeServer.IsTravelRequest(Travel, 0x9d32c5b4), 'connect is never travel');

    const Req = ChangeServer.ReadRequest(Travel);
    Assert.strictEqual(Req.WorldKey >>> 0, Crc('SLAMBALL'));
    Assert.strictEqual(Req.MatchType, 0xa91b4ef87f821cd9n, 'the destination match token is not the player puid');
    Assert.strictEqual(Req.Puid, 0x0110000100000666n);
    Assert.strictEqual(Worlds.Label(Req.WorldKey), 'slamball');
});

Test('the travel reply carries MATCH_TYPE rather than substituting PUID', () => {
    const Match = 0xa91b4ef87f821cd9n;
    const Body = new FieldList.Builder()
        .AddU64('MATCH_TYPE', Match)
        .AddU32(0x4b7ad8c3, Worlds.ActivityFor(Crc('BOULEVARD')))
        .AddU32('NAME', Worlds.ServerType.World)
        .AddU32('LOCATION', Crc('BOULEVARD'))
        .AddU32('COMMAND', ChangeServer.StartConnection)
        .AddU64('PUID', 0x0110000100000666n)
        .Build();
    const Req = Frame.Build(0xce148fb1, Buffer.from('fa68000000000000', 'hex'), Body, Frame.InnerHeader.None);
    let Reply = null;
    const Connection = {
        Identifier: '0110000100000666',
        Puid: 0x0110000100000666n,
        Socket: { localAddress: '203.0.113.10' },
        Port: 20054,
        Send(FrameData) {
            Reply = FrameData;
            return true;
        },
    };

    OnTravelRequest(Connection, Frame.Parse(Req), Req);
    Assert.ok(Reply, 'travel produced a response');
    Assert.strictEqual(Reply.readBigUInt64BE(16 + ChangeServer.Offset.SessionId), Match);
    Assert.notStrictEqual(Reply.readBigUInt64BE(16 + ChangeServer.Offset.SessionId), Connection.Puid);
    Assert.strictEqual(Reply.length, 1266);
});

Test('a field list is located without being told where it starts', () => {
    const Body = new FieldList.Builder().AddU32('LOCATION', Crc('GAMBLING')).AddU32('NAME', 0xf2929087).Build();
    for (const Inner of [Frame.InnerHeader.None, Frame.InnerHeader.Object, Frame.InnerHeader.Pending]) {
        const FrameData = Frame.Build(0xce148fb1, Buffer.alloc(8), Body, Inner);
        const At = FieldList.Locate(FrameData);
        Assert.ok(At >= 0, `located for inner header ${Inner}`);
        const List = FieldList.Parse(FrameData, At);
        Assert.strictEqual(FieldList.Find(List, 'LOCATION').Data1 >>> 0, Crc('GAMBLING'), `inner header ${Inner}`);
    }
});

Test('mycourt is recognised by server type or by the crib world key', () => {
    Assert.ok(ChangeServer.IsMyCourtDestination({ ServerType: Worlds.ServerType.MyCourt, WorldKey: 0 }));
    Assert.ok(ChangeServer.IsMyCourtDestination({ ServerType: 0, WorldKey: Crc('CRIB') }));
    Assert.ok(!ChangeServer.IsMyCourtDestination({ ServerType: 0, WorldKey: Crc('GAMBLING') }));
});

process.stdout.write(`\n${Passed} passing\n`);
