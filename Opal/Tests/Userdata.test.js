// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Assert = require('assert');
const Fs = require('fs');
const Path = require('path');
const Zlib = require('zlib');

const Log = require('../Source/Core/Log');
const { Crc } = require('../Source/Core/Names');
const FieldList = require('../Source/Codec/FieldList');
const Frame = require('../Source/Codec/Frame');
const Roster = require('../Source/Protocol/Roster');
const Userdata = require('../Source/Protocol/Userdata');
const Activities = require('../Source/Activity/Activities');
const WebSocket = require('../Source/Net/Websocket');
const {
    Connection,
    State,
    OnConnect,
    RefreshRosterForPeers,
    EntriesWithUserdata,
} = require('../Source/Protocol/Connection');

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

function FakeSocket(Sink) {
    return { destroyed: false, localAddress: '127.0.0.1', write: (B) => Sink.push(B) };
}

function Player(Sink, MachineHint) {
    const C = new Connection(FakeSocket(Sink), {}, 20054);
    return C;
}

function UserdataFrame(MachineId, Profile, Command = Crc('USERDATA')) {
    const Body = new FieldList.Builder()
        .AddBlob('COMPRESSED_DATA', Zlib.deflateSync(Profile))
        .AddU32('COMMAND', Command)
        .Build();
    const ConnectionId = Buffer.alloc(8);
    ConnectionId.writeBigUInt64LE(BigInt(MachineId));
    return Frame.Build(0x9e3471ed, ConnectionId, Body, Frame.InnerHeader.Object);
}

function ConnectFrame(Puid, WorldKey) {
    const Body = new FieldList.Builder()
        .AddU64('USER_ID_LIST', Puid)
        .AddU32('LOCATION', WorldKey)
        .AddU32(0x4b7ad8c3, 0)
        .Build();
    return Frame.Build(0x9d32c5b4, Buffer.alloc(8), Body, Frame.InnerHeader.None);
}

Test('userdata app element is exactly packet type followed by packet body', () => {
    const Client = Player([]);
    const FrameData = UserdataFrame(Client.MachineId, Buffer.alloc(384, 0x5a));
    Client.Userdata = FrameData;

    const Element = Userdata.ElementFor(Client);
    Assert.ok(Element, 'stored userdata produces an application-packet element');
    Assert.strictEqual(Element.readUInt32BE(0), 0x9e3471ed);
    Assert.ok(
        Element.subarray(0, 4).equals(FrameData.subarray(4, 8)),
        'the element begins with the packet type/channel',
    );
    Assert.ok(
        Element.subarray(4).equals(FrameData.subarray(Frame.HeaderSize)),
        'the 16-byte communications header is removed and the packet body is intact',
    );
});

Test('every connection gets a distinct machine id', () => {
    const Sink = [];
    const A = Player(Sink),
        B = Player(Sink),
        C = Player(Sink);
    const Ids = new Set([A.MachineId, B.MachineId, C.MachineId]);
    Assert.strictEqual(Ids.size, 3, 'a shared machine id makes players indistinguishable');
    Assert.strictEqual(B.MachineId - A.MachineId, 1n);
});

Test('the init reply hands each player its own machine id and the full roster', () => {
    Roster.Players.clear();
    const Sink = [];
    const Stage = Activities.Activities.find((X) => X.Name === 'stage');

    const A = Player(Sink);
    A.Puid = 0x0110000100000001n;
    A.ActivityKey = Stage.ActivityKey;
    const B = Player(Sink);
    B.Puid = 0x0110000100000002n;
    B.ActivityKey = Stage.ActivityKey;
    A.State = State.Active;
    B.State = State.Active;
    Roster.Add(A);
    Roster.Add(B);

    const Reply = Activities.BuildInit(Stage, Roster.EntriesFor(Stage.ActivityKey), B.MachineId);
    const List = FieldList.Parse(Reply, Frame.HeaderSize);

    const Accounts = List.Fields.filter((F) => F.Crc === Crc('USER_ID_LIST')).map((F) => F.Value);
    const Machines = List.Fields.filter((F) => F.Crc === 0x92cd7d5b).map((F) => F.Value);
    Assert.deepStrictEqual(Accounts, [A.Puid, B.Puid], 'both players are in the roster');
    Assert.deepStrictEqual(Machines, [A.MachineId, B.MachineId]);

    const Self = List.Fields.find((F) => F.Crc === 0xc56500f9);
    Assert.strictEqual(Self.Value, B.MachineId, 'and the recipient is told which one is itself');
});

Test('activity roster snapshots package exactly the native 223256-byte USERDATA field', () => {
    Roster.Players.clear();
    const Stage = Activities.Activities.find((X) => X.Name === 'stage');
    const PlayerData = Player([]);
    PlayerData.Puid = 0x0110000100000001n;
    PlayerData.ActivityKey = Stage.ActivityKey;
    PlayerData.State = State.Active;
    PlayerData.Userdata = UserdataFrame(PlayerData.MachineId, Buffer.alloc(287208, 0x31));
    Roster.Add(PlayerData);

    const Reply = Activities.BuildInit(Stage, EntriesWithUserdata(Stage.ActivityKey), PlayerData.MachineId);
    const Outer = FieldList.Parse(Reply, Frame.HeaderSize);
    const Entry = FieldList.Find(Outer, 0x9ad3e8f7);
    const SportsUser = FieldList.Parse(Zlib.inflateSync(FieldList.ReadBlob(Outer, Entry)), 0);
    const Packaged = FieldList.ReadBlob(SportsUser, FieldList.Find(SportsUser, 0xcdbd175e));
    Assert.strictEqual(Packaged.length, Userdata.InflatedLength);
});

Test('an incumbent receives a refreshed roster before a late player is published', () => {
    Roster.Players.clear();
    const Inbox = [];
    const Stage = Activities.Activities.find((X) => X.Name === 'stage');

    const Early = Player(Inbox);
    Early.Puid = 0x0110000100000001n;
    Early.ActivityKey = Stage.ActivityKey;
    Early.State = State.Active;
    Roster.Add(Early);

    const Late = Player([]);
    Late.Puid = 0x0110000100000002n;
    Late.ActivityKey = Stage.ActivityKey;
    Late.State = State.Active;
    Roster.Add(Late);

    Assert.strictEqual(RefreshRosterForPeers(Late, Stage, 'test'), 1);
    Assert.strictEqual(Inbox.length, 1);
    const Decoded = WebSocket.Decode(Inbox[0]);
    Assert.strictEqual(Decoded.Messages.length, 1);
    const Payload = Decoded.Messages[0].Payload;
    Assert.strictEqual(Payload.readUInt32BE(4), 0x9d32c5b4);
    const List = FieldList.Parse(Payload, Frame.HeaderSize);
    const Ids = List.Fields.filter((F) => F.Crc === Crc('USER_ID_LIST')).map((F) => F.Value);
    Assert.deepStrictEqual(Ids, [Early.Puid, Late.Puid]);
    Assert.strictEqual(
        FieldList.Find(List, 0xc56500f9).Value,
        Early.MachineId,
        'the refreshed reply still identifies the incumbent as self',
    );
});

Test('a userdata frame reaches the peers in the same activity', () => {
    Roster.Players.clear();
    const Inbox = [];
    const Stage = Activities.Activities.find((X) => X.Name === 'stage');

    const Sender = Player([]);
    Sender.ActivityKey = Stage.ActivityKey;
    Sender.State = State.Active;
    const Peer = new Connection(FakeSocket(Inbox), {}, 20054);
    Peer.ActivityKey = Stage.ActivityKey;
    Peer.State = State.Active;
    Peer.KnownPlayers.add(Sender.Id);
    Roster.Add(Sender);
    Roster.Add(Peer);

    const Sent = Userdata.Relay(Sender, UserdataFrame(Sender.MachineId, Buffer.alloc(2048, 7)));
    Assert.strictEqual(Sent, 1);
    Assert.strictEqual(Inbox.length, 1, 'the peer received it');
});

Test('the first full profile names the peer and refreshes the VCONLINE Near-Me roster', () => {
    Roster.Players.clear();
    const Inbox = [];
    const Stage = Activities.Activities.find((X) => X.Name === 'stage');

    const Sender = Player([]);
    Sender.Puid = 0x0110000100000001n;
    Sender.ActivityKey = Stage.ActivityKey;
    Sender.State = State.Active;
    const Peer = Player(Inbox);
    Peer.Puid = 0x0110000100000002n;
    Peer.ActivityKey = Stage.ActivityKey;
    Peer.State = State.Active;
    Peer.KnownPlayers.add(Sender.Id);
    Roster.Add(Sender);
    Roster.Add(Peer);

    const Profile = Buffer.alloc(Userdata.InflatedLength);
    Profile.write('rokuogun\0', 12, 'utf16le');
    Assert.strictEqual(Userdata.Relay(Sender, UserdataFrame(Sender.MachineId, Profile)), 1);
    Assert.strictEqual(Sender.Gamertag, 'rokuogun');
    Assert.strictEqual(Sender.VconlineProfileReady, true);

    const Payloads = Inbox.flatMap((FrameData) => WebSocket.Decode(FrameData).Messages.map((M) => M.Payload));
    const RosterReply = Payloads.find((Payload) => Payload.readUInt32BE(4) === 0x9d32c5b4);
    Assert.ok(RosterReply, 'a post-userdata roster refresh was sent');
    const Outer = FieldList.Parse(RosterReply, Frame.HeaderSize);
    const Packaged = Outer.Fields.filter((Field) => Field.Crc === 0x9ad3e8f7);
    const Inner = FieldList.Parse(Zlib.inflateSync(FieldList.ReadBlob(Outer, Packaged[0])), 0);
    Assert.strictEqual(FieldList.ReadString(Inner, FieldList.Find(Inner, 0x8cb84fe9)), 'rokuogun');
});

Test('it does not reach a player in a different activity', () => {
    Roster.Players.clear();
    const Inbox = [];
    const Stage = Activities.Activities.find((X) => X.Name === 'stage');
    const Cages = Activities.Activities.find((X) => X.Name === 'cages');

    const Sender = Player([]);
    Sender.ActivityKey = Stage.ActivityKey;
    Sender.State = State.Active;
    const Elsewhere = new Connection(FakeSocket(Inbox), {}, 20054);
    Elsewhere.ActivityKey = Cages.ActivityKey;
    Elsewhere.State = State.Active;
    Roster.Add(Sender);
    Roster.Add(Elsewhere);

    const Sent = Userdata.Relay(Sender, UserdataFrame(Sender.MachineId, Buffer.alloc(512, 3)));
    Assert.strictEqual(Sent, 0, 'the old relay sent this to everyone regardless of activity');
    Assert.strictEqual(Inbox.length, 0);
});

Test('a compressed command that is not userdata is not broadcast', () => {
    Roster.Players.clear();
    const Inbox = [];
    const Stage = Activities.Activities.find((X) => X.Name === 'stage');

    const Sender = Player([]);
    Sender.ActivityKey = Stage.ActivityKey;
    Sender.State = State.Active;
    const Peer = new Connection(FakeSocket(Inbox), {}, 20054);
    Peer.ActivityKey = Stage.ActivityKey;
    Peer.State = State.Active;
    Peer.KnownPlayers.add(Sender.Id);
    Roster.Add(Sender);
    Roster.Add(Peer);

    const Other = UserdataFrame(Sender.MachineId, Buffer.alloc(256, 1), Crc('GOT_NEXT'));
    Assert.strictEqual(
        Userdata.Relay(Sender, Other),
        0,
        'the old relay forwarded any compressed command without reading the command id',
    );
    Assert.strictEqual(Inbox.length, 0);
});

Test('a relayed frame preserves the sender transport identity byte for byte', () => {
    Roster.Players.clear();
    const Inbox = [];
    const Stage = Activities.Activities.find((X) => X.Name === 'stage');

    const Sender = Player([]);
    Sender.ActivityKey = Stage.ActivityKey;
    Sender.State = State.Active;
    const Peer = new Connection(FakeSocket(Inbox), {}, 20054);
    Peer.ActivityKey = Stage.ActivityKey;
    Peer.State = State.Active;
    Peer.KnownPlayers.add(Sender.Id);
    Roster.Add(Sender);
    Roster.Add(Peer);
    Assert.notStrictEqual(Sender.MachineId, Peer.MachineId);

    const FrameData = UserdataFrame(Sender.MachineId, Buffer.alloc(1024, 9));
    Userdata.Relay(Sender, FrameData);

    const Delivered = Inbox[0].slice(Inbox[0].length - FrameData.length);
    Assert.strictEqual(Delivered.readBigUInt64LE(8), Sender.MachineId);
    Assert.ok(Delivered.equals(FrameData), 'the source frame is relayed intact');
});

Test('a player who arrives late is given the userdata already shared', () => {
    Roster.Players.clear();
    const Stage = Activities.Activities.find((X) => X.Name === 'stage');

    const Early = Player([]);
    Early.ActivityKey = Stage.ActivityKey;
    Early.State = State.Active;
    Roster.Add(Early);
    Userdata.Relay(Early, UserdataFrame(Early.MachineId, Buffer.alloc(700, 5)));
    Assert.ok(Early.Userdata, 'the sender stored a copy');

    const Inbox = [];
    const Late = new Connection(FakeSocket(Inbox), {}, 20054);
    Late.ActivityKey = Stage.ActivityKey;
    Late.State = State.Active;
    Late.KnownPlayers.add(Early.Id);
    Roster.Add(Late);

    Assert.strictEqual(Userdata.ReplayTo(Late), 1);
    Assert.strictEqual(Inbox.length, 1, 'so the newcomer can build the player already there');
});

Test('a late joiner in another activity is given nothing', () => {
    Roster.Players.clear();
    const Stage = Activities.Activities.find((X) => X.Name === 'stage');
    const Cages = Activities.Activities.find((X) => X.Name === 'cages');

    const Early = Player([]);
    Early.ActivityKey = Stage.ActivityKey;
    Early.State = State.Active;
    Roster.Add(Early);
    Userdata.Relay(Early, UserdataFrame(Early.MachineId, Buffer.alloc(700, 5)));

    const Inbox = [];
    const Late = new Connection(FakeSocket(Inbox), {}, 20054);
    Late.ActivityKey = Cages.ActivityKey;
    Late.State = State.Active;
    Roster.Add(Late);

    Assert.strictEqual(Userdata.ReplayTo(Late), 0);
    Assert.strictEqual(Inbox.length, 0);
});

Test('userdata is held until the recipient has the source player object', () => {
    Roster.Players.clear();
    const Inbox = [];
    const Stage = Activities.Activities.find((X) => X.Name === 'stage');
    const Sender = Player([]);
    Sender.ActivityKey = Stage.ActivityKey;
    Sender.State = State.Active;
    const Peer = new Connection(FakeSocket(Inbox), {}, 20054);
    Peer.ActivityKey = Stage.ActivityKey;
    Peer.State = State.Active;
    Roster.Add(Sender);
    Roster.Add(Peer);

    Assert.strictEqual(Userdata.Relay(Sender, UserdataFrame(Sender.MachineId, Buffer.alloc(512, 4))), 0);
    Assert.strictEqual(Inbox.length, 0, 'profile cannot precede PLAYER OBJECT_DATA');
    Assert.ok(Sender.Userdata, 'the profile remains stored for post-create replay');
});

const CapturedPath = Path.join(__dirname, 'Frames', 'Userdata.txt');
if (Fs.existsSync(CapturedPath)) {
    Test('a real captured userdata frame reads as userdata and inflates', () => {
        const Hex = Fs.readFileSync(CapturedPath, 'utf8').trim().split(/\s+/).pop();
        const FrameData = Buffer.from(Hex, 'hex');
        const Payload = Userdata.Read(FrameData);
        Assert.ok(Payload, 'the capture parses');
        Assert.strictEqual(Payload.IsUserdata, true);
        const Inflated = Zlib.inflateSync(Payload.Blob);
        Assert.ok(Inflated.length > Payload.Blob.length * 10, 'the profile is a large mostly empty struct');
    });
}

Test('two players in the same activity end up in each others roster', () => {
    Roster.Players.clear();
    const First = [],
        Second = [];
    const A = new Connection(FakeSocket(First), {}, 20054);
    OnConnect(
        A,
        Frame.Parse(ConnectFrame(0x0110000100000001n, Crc('GAMBLING'))),
        ConnectFrame(0x0110000100000001n, Crc('GAMBLING')),
    );

    const B = new Connection(FakeSocket(Second), {}, 20054);
    OnConnect(
        B,
        Frame.Parse(ConnectFrame(0x0110000100000002n, Crc('GAMBLING'))),
        ConnectFrame(0x0110000100000002n, Crc('GAMBLING')),
    );

    Assert.strictEqual(A.State, State.Active);
    Assert.strictEqual(B.State, State.Active);
    Assert.notStrictEqual(A.MachineId, B.MachineId, 'sharing a machine id would make them the same player on the wire');

    Assert.ok(
        Roster.Peers(B).some((P) => P.Id === A.Id),
        'a is a peer of b',
    );
    Assert.ok(
        Roster.Peers(A).some((P) => P.Id === B.Id),
        'and b is a peer of a',
    );

    Assert.strictEqual(Roster.EntriesFor(B.ActivityKey).length, 2);

    const FirstInits = First.map((Wire) => WebSocket.Decode(Wire).Messages[0].Payload).filter(
        (Payload) => Payload.length >= 8 && Payload.readUInt32BE(4) === 0x9d32c5b4,
    );
    Assert.strictEqual(FirstInits.length, 2, 'the incumbent got one live roster refresh');
    const Refreshed = FieldList.Parse(FirstInits[1], Frame.HeaderSize);
    Assert.strictEqual(Refreshed.Fields.filter((F) => F.Crc === Crc('USER_ID_LIST')).length, 2);
});

const PlayerObject = require('../Source/Protocol/PlayerObject');
const ObjectFrame = require('../Source/Codec/ObjectFrame');

Test('the proven 2K19 field-prefix walk closes field 110 exactly', () => {
    const Table = PlayerObject.PlayerBody;
    const Header = Buffer.alloc(Table.ValuesStart);
    for (let Field = 0; Field < Table.Widths.length; Field++) {
        Header[16 + (Field >> 3)] |= 0x80 >> (Field & 7);
    }
    const Values = Table.Widths.map((Width, Field) => Buffer.alloc(Table.ArrayFields.has(Field) ? 4 : Width));
    const Serialized = Buffer.concat([Header, ...Values]);
    const Allocation = Buffer.concat([Serialized, Buffer.alloc(1325, 0xa5)]);

    const Decoded = Table.Decode(Allocation);
    Assert.strictEqual(Decoded.Ok, true);
    Assert.strictEqual(Decoded.Length, Serialized.length);
    Assert.strictEqual(Decoded.Offsets.get(87), 231, 'gamertag begins at the proven offset');

    const Trimmed = Table.Trim(Allocation);
    Assert.strictEqual(Trimmed.Body.length, Serialized.length);
    Assert.strictEqual(Trimmed.Trimmed, 1325);
    Assert.ok(Trimmed.Body.equals(Serialized));
});

function GenerationBody(Puid, FakePlayerFlag, FakePlayerData) {
    const Table = PlayerObject.PlayerBody;
    const Data = Buffer.from(FakePlayerData || []);
    const Header = Buffer.alloc(Table.ValuesStart);
    for (const Field of [Table.Field.Puid, Table.Field.FakePlayerFlag, Table.Field.FakePlayerData]) {
        Header[16 + (Field >> 3)] |= 0x80 >> (Field & 7);
    }
    const ValuePuid = Buffer.alloc(8);
    ValuePuid.writeBigUInt64LE(Puid);
    const ValueData = Buffer.alloc(4 + Data.length);
    ValueData.writeUInt32LE(Data.length);
    Data.copy(ValueData, 4);
    return Buffer.concat([Header, ValuePuid, Buffer.from([FakePlayerFlag]), ValueData]);
}

Test('the actual 2K19 PLAYER generation contract selects AddPlayer for peers', () => {
    const Table = PlayerObject.PlayerBody;
    const Puid = 0x0110000100000042n;
    const Real = Table.InspectGeneration(GenerationBody(Puid, 0, []));
    Assert.strictEqual(Real.Ok, true);
    Assert.strictEqual(Real.GenerationOk, true);
    Assert.strictEqual(Real.Puid, Puid);
    Assert.strictEqual(Real.FakePlayerFlag, 0);
    Assert.strictEqual(Real.FakePlayerDataBytes, 0);
    Assert.strictEqual(Real.RealPeer, true, 'field 82=0 / field 99 empty takes REMOTE_PLAYERMANAGER::AddPlayer');

    const Fake = Table.InspectGeneration(GenerationBody(Puid, 1, [0xaa]));
    Assert.strictEqual(Fake.Ok, true);
    Assert.strictEqual(Fake.GenerationOk, true);
    Assert.strictEqual(Fake.RealPeer, false, 'only both non-zero values select the fake-player branch');
});

const HandshakeOne = Path.join(__dirname, 'Frames', 'Handshake1.txt');
const HandshakeTwo = Path.join(__dirname, 'Frames', 'Handshake2.txt');

function LoadFrame(File) {
    return Buffer.from(Fs.readFileSync(File, 'utf8').trim().split(/\s+/).pop(), 'hex');
}

if (Fs.existsSync(HandshakeOne) && Fs.existsSync(HandshakeTwo)) {
    const First = LoadFrame(HandshakeOne);
    const Second = LoadFrame(HandshakeTwo);

    Test('the instantiating body comes from the handshake and is complete', () => {
        const Hand = PlayerObject.ExtractHandshakeBody(First);
        Assert.ok(Hand, 'the handshake carries a body');
        Assert.strictEqual(Hand.BlobKey, PlayerObject.DataBlobKey, 'keyed crc32("DATA")');
        Assert.strictEqual(Hand.Body.readBigUInt64BE(0), Hand.PlayerId, 'first value is the puid');

        const Presence = Hand.Body.slice(16, 36).toString('hex');
        Assert.match(Presence, /^f+$/, 'the presence bitmap is all ones');
        Assert.ok(Hand.Body.length > 1000, `a complete body, got ${Hand.Body.length}`);
    });

    Test('a world state update is a partial and must not instantiate anyone', () => {
        const BodyPath = Path.join(__dirname, 'Frames', 'PlayerObject.txt');
        if (!Fs.existsSync(BodyPath)) return;
        const Update = LoadFrame(BodyPath);
        const Parsed = ObjectFrame.Parse(Update);
        Assert.strictEqual(Parsed.ClassName, 'PLAYER');
        Assert.ok(
            Parsed.Flags.length < Parsed.FlagCount,
            'the update sets only some fields, which cannot build a character',
        );
        Assert.strictEqual(
            PlayerObject.ExtractHandshakeBody(Update),
            null,
            'and it is not a handshake, so it yields no instantiating body',
        );
    });

    Test('the relayed frame obeys every rule', () => {
        Roster.Players.clear();
        PlayerObject.BestBodies.clear();
        const Inbox = [];
        const Stage = Activities.Activities.find((X) => X.Name === 'stage');

        const A = new Connection(FakeSocket([]), {}, 20054);
        A.ActivityKey = Stage.ActivityKey;
        A.State = State.Active;
        Roster.Add(A);
        PlayerObject.Register(A, First);

        const B = new Connection(FakeSocket(Inbox), {}, 20054);
        B.ActivityKey = Stage.ActivityKey;
        B.State = State.Active;
        Roster.Add(B);
        Assert.strictEqual(PlayerObject.Register(B, Second), 1, 'b became visible to a');
        Assert.ok(Inbox.length >= 1, 'and b was told about a');

        const FrameData = PlayerObject.FrameFor(A);
        const Parsed = ObjectFrame.Parse(FrameData);
        const Hand = PlayerObject.ExtractHandshakeBody(First);
        Assert.strictEqual(
            FrameData.readUInt32BE(4),
            PlayerObject.ObjectDataPacket,
            'rule 4: a player cannot be sent as an object update',
        );
        Assert.strictEqual(FrameData.readBigUInt64BE(8), 0n, 'rule 1: connection id is zero');
        Assert.strictEqual(Parsed.ObjectId, A.Puid);
        Assert.strictEqual(Parsed.Key, Parsed.ObjectId, 'the body key echoes the object id');
        Assert.strictEqual(Parsed.Flags.length, Parsed.FlagCount, 'rule 3: a complete body');
        Assert.strictEqual(
            Parsed.Payload.length,
            Hand.Body.length,
            'the complete 149-field handshake blob is preserved, not cut at field 110',
        );
    });

    Test('disconnect uses the exact 2K19 object-destroy body', () => {
        const Hand = PlayerObject.ExtractHandshakeBody(First);
        const Client = { Puid: Hand.PlayerId };
        const FrameData = PlayerObject.DestroyFrameFor(Client);
        Assert.strictEqual(FrameData.readUInt32BE(4), PlayerObject.ObjectDestroyPacket);
        Assert.strictEqual(FrameData.readBigUInt64BE(8), 0n);
        Assert.strictEqual(FrameData.readBigUInt64BE(16), Hand.PlayerId);
        Assert.strictEqual(FrameData.length, 24);
    });

    Test('revisions strictly increase, or a peer renders once and freezes', () => {
        Roster.Players.clear();
        PlayerObject.BestBodies.clear();
        const A = new Connection(FakeSocket([]), {}, 20054);
        A.ActivityKey = 0x3cf672c2;
        A.State = State.Active;
        Roster.Add(A);
        PlayerObject.Register(A, First);

        const Seen = [];
        for (let I = 0; I < 4; I++) {
            Seen.push(ObjectFrame.Parse(PlayerObject.FrameFor(A)).Version);
        }
        for (let I = 1; I < Seen.length; I++) {
            Assert.ok(Seen[I] > Seen[I - 1], `revision ${Seen[I]} must exceed ${Seen[I - 1]}`);
        }
    });

    Test('the fullest body ever seen for a puid is the one kept', () => {
        Roster.Players.clear();
        PlayerObject.BestBodies.clear();
        const A = new Connection(FakeSocket([]), {}, 20054);
        A.ActivityKey = 0x3cf672c2;
        A.State = State.Active;
        Roster.Add(A);
        PlayerObject.Register(A, First);
        const Full = A.PlayerBody.length;

        Roster.Remove(A);
        const Hand = PlayerObject.ExtractHandshakeBody(First);
        PlayerObject.BestBodies.set(Hand.PlayerId.toString(16).padStart(16, '0'), Hand.Body.slice(0, 200));

        const B = new Connection(FakeSocket([]), {}, 20054);
        B.ActivityKey = 0x3cf672c2;
        B.State = State.Active;
        Roster.Add(B);
        PlayerObject.Register(B, First);
        Assert.strictEqual(
            B.PlayerBody.length,
            Full,
            'a short body decodes to an empty character, so the fuller one is kept',
        );
    });

    Test('two players sharing a client puid are de-collided on the World wire', () => {
        Roster.Players.clear();
        PlayerObject.BestBodies.clear();
        const A = new Connection(FakeSocket([]), {}, 20054);
        A.ActivityKey = 0x3cf672c2;
        A.State = State.Active;
        Roster.Add(A);
        PlayerObject.Register(A, First);

        const Twin = new Connection(FakeSocket([]), {}, 20054);
        Twin.ActivityKey = 0x3cf672c2;
        Twin.State = State.Active;
        Roster.Add(Twin);
        Assert.strictEqual(PlayerObject.Register(Twin, First), 1, 'the second player is still announced to the first');
        Assert.notStrictEqual(Twin.Puid, A.Puid, 'the client would discard a second object carrying its own PUID');
        Assert.strictEqual(
            Twin.PlayerBody.readBigUInt64BE(PlayerObject.Body.Key),
            Twin.Puid,
            'the server object key uses the assigned World PUID',
        );
        const ValueOffset = PlayerObject.FindPuidValue(Twin.PlayerBody, Twin.Puid);
        Assert.ok(ValueOffset >= 0, 'the embedded little-endian PUID was rewritten too');
        Assert.strictEqual(Twin.PlayerBody.readBigUInt64LE(ValueOffset), Twin.Puid);
    });
}

process.stdout.write(`
${Passed} passing
`);
