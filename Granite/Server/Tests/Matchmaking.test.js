// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Test = require('node:test');
const Assert = require('node:assert/strict');
const Fs = require('node:fs');
const Https = require('node:https');
const Os = require('node:os');
const Path = require('node:path');
const { Builder, Types, Parse, GetField, GetFields, GetU32, GetU64 } = require('../Source/Codec/FieldList');
const Matchmaking = require('../Source/Services/GameStats/Matchmaking');
const { RouteKey, CreateGraniteServer } = require('../Source/Server');
const VconlineRelay = require('../../../Opal/Source/Net/VconlineRelay');

const { Crcs, Results, Constants } = Matchmaking;

function Req({ BodyId, SessionId = 0n, Sequence = 0n, Marker = 1 }) {
    const ListBuilder = new Builder()
        .AddU64(Crcs.UserIds, BodyId)
        .AddBinary(Crcs.UserData, Buffer.from([0x78, 0xda, Marker]))
        .AddBinary(Crcs.MachineData, Buffer.alloc(32, Marker));
    if (SessionId) ListBuilder.AddU64(Crcs.SearchSessionId, SessionId);
    if (Sequence) ListBuilder.AddU64(Crcs.Sequence, Sequence);
    const Built = ListBuilder.Build();
    return { Body: Built.Body, Parsed: Parse(Built.Body) };
}

function ValidateNativeSuccess(Reply, SelfId, ExpectedPlayers) {
    const { Fields } = Parse(Reply.Body);
    Assert.equal(GetU32(Fields, Crcs.ResultType), Results.Success);
    Assert.notEqual(GetU64(Fields, Crcs.TicketId), 0n);
    Assert.notEqual(GetU64(Fields, Crcs.Sequence), 0n);
    Assert.equal(GetU64(Fields, Crcs.RecipientMachineId), SelfId);
    Assert.equal(GetU32(Fields, Crcs.MatchKind), Constants.MatchKind);
    Assert.equal(GetU32(Fields, Crcs.NetworkKind), Constants.NetworkKind);

    const Relay = GetField(Fields, Crcs.RelayAddress, 0, Types.Packed);
    Assert.ok(Relay, '0x6CD5D4F9 must use the Packed network-address type');
    Assert.equal(Relay.Data1, 0xcb00710a);
    Assert.equal(Relay.Data2, ((28091 << 16) | 0x2628) >>> 0);

    const Token = GetField(Fields, Crcs.RelayToken, 0, Types.Binary);
    Assert.equal(Token.Raw.length, 16);
    Assert.notDeepEqual(Token.Raw, Buffer.alloc(16));

    const Machines = GetFields(Fields, Crcs.MachineIds, Types.U64).map((Field) => Field.value);
    const Counts = GetFields(Fields, Crcs.MachinePuCounts, Types.U64).map((Field) => Field.value);
    const Users = GetFields(Fields, Crcs.UserIds, Types.U64).map((Field) => Field.value);
    Assert.deepEqual(Machines, ExpectedPlayers);
    Assert.deepEqual(
        Counts,
        ExpectedPlayers.map(() => 1n),
    );
    Assert.deepEqual(Users, ExpectedPlayers);
    Assert.ok(Machines.includes(SelfId), '0xC56500F9 must occur in 0x92CD7D5B');
    Assert.equal(
        Users.length,
        Counts.reduce((Sum, Value) => Sum + Number(Value), 0),
    );
    Assert.ok(Users.every(Boolean), 'native parser rejects a zero user record');
    Assert.equal(GetFields(Fields, Crcs.UserData, Types.Binary).length, Users.length);
    Assert.equal(GetFields(Fields, Crcs.UserFlags, Types.U64).length, Users.length);
    Assert.equal(GetFields(Fields, Crcs.MachineData, Types.Binary).length, Machines.length);
    return { Fields, Token: Buffer.from(Token.Raw) };
}

Test('real 2K19 mmg route paths resolve to quick/search and quick/update', () => {
    Assert.equal(RouteKey('/nba/2k19/mmg/quick/search?x=one'), 'quick/search');
    Assert.equal(RouteKey('/nba/2k19/mmg/quick/update?x=one'), 'quick/update');
    Assert.equal(Matchmaking.RouteName('/nba/2k19/mmg/quick/search'), 'quick/search');
});

Test('two authenticated Play Now users pair and receive one shared Opal relay room', () => {
    const Service = Matchmaking.Create({
        PublicHost: '203.0.113.10',
        RelayPort: 28091,
        RelayId: 0x2628,
    });
    const One = 76561198843023395n;
    const Two = 76561199290468632n;

    const First = Matchmaking.Build(Req({ BodyId: 999n, Marker: 1 }), {
        Route: 'quick/search',
        Matchmaking: Service,
        userId: One,
    });
    const FirstFields = Parse(First.Body).Fields;
    Assert.equal(GetU32(FirstFields, Crcs.ResultType), Results.InProgress);
    const FirstSession = GetU64(FirstFields, Crcs.SearchSessionId);
    Assert.notEqual(FirstSession, 0n);

    const Second = Matchmaking.Build(Req({ BodyId: 888n, Marker: 2 }), {
        Route: 'quick/search',
        Matchmaking: Service,
        userId: Two,
    });
    const SecondOk = ValidateNativeSuccess(Second, Two, [One, Two]);

    const FirstPoll = Matchmaking.Build(
        Req({
            BodyId: 777n,
            SessionId: FirstSession,
            Sequence: 5n,
            Marker: 1,
        }),
        { Route: 'quick/update', Matchmaking: Service, userId: One },
    );
    const FirstOk = ValidateNativeSuccess(FirstPoll, One, [One, Two]);

    const ExpectedLeader = One < Two ? One : Two;
    Assert.equal(Service.ByPlayer.get(One.toString()).Match.LeaderMachineId, ExpectedLeader);
    Assert.deepEqual(
        GetFields(FirstOk.Fields, Crcs.MachineIds, Types.U64).map((Field) => Field.value),
        [One, Two].sort((Left, Right) => (Left < Right ? -1 : Left > Right ? 1 : 0)),
        'the machine array must be ordered around the native lowest-id leader rule',
    );

    Assert.deepEqual(FirstOk.Token, SecondOk.Token, 'both clients must present the same 16-byte token to Opal');
    Assert.equal(
        GetU64(FirstOk.Fields, Crcs.Sequence),
        GetU64(SecondOk.Fields, Crcs.Sequence),
        'one 0x1780EC1F for the whole match: ConnectivityPacketReceived rejects a lower peer sequence',
    );
    Assert.notEqual(
        GetU64(FirstOk.Fields, Crcs.RecipientMachineId),
        GetU64(SecondOk.Fields, Crcs.RecipientMachineId),
        'clients must present distinct U64 machine ids to Opal',
    );

    const RelayConnect = (Ok) => {
        const Relay = GetField(Ok.Fields, Crcs.RelayAddress, 0, Types.Packed);
        const Packet = Buffer.alloc(VconlineRelay.ConnectLength);
        Packet.writeUInt32BE(
            VconlineRelay.BuildHeader(
                VconlineRelay.Type.Connect,
                VconlineRelay.Routing.Delivered,
                Packet.length,
                Relay.Data2 & 0xffff,
            ),
            0,
        );
        Ok.Token.copy(Packet, 4);
        Packet.writeBigUInt64BE(GetU64(Ok.Fields, Crcs.RecipientMachineId), 20);
        return Packet;
    };
    const Sent = [];
    const Router = new VconlineRelay.Router((Packet, Endpoint) => Sent.push({ Packet, Endpoint }));
    Router.Handle(RelayConnect(FirstOk), { address: '127.0.0.1', port: 31001 });
    Router.Handle(RelayConnect(SecondOk), { address: '127.0.0.1', port: 31002 });
    Sent.length = 0;
    const Payload = Buffer.from('pno-peer-data');
    const Datagram = Buffer.alloc(4 + Payload.length);
    Datagram.writeUInt32BE(
        VconlineRelay.BuildHeader(VconlineRelay.Type.Unreliable, VconlineRelay.Routing.Others, Datagram.length, 0x2628),
        0,
    );
    Payload.copy(Datagram, 4);
    const Delivered = Router.Handle(Datagram, { address: '127.0.0.1', port: 31001 });
    Assert.equal(Delivered.Sent, 1);
    Assert.equal(Sent[0].Endpoint.Port, 31002);
    Assert.deepEqual(Sent[0].Packet.subarray(4), Payload);
});

Test('repeat searches from one account reuse its session and never self-pair', () => {
    const Service = Matchmaking.Create({ PublicHost: '127.0.0.1' });
    const User = 76561198843023395n;
    const First = Parse(
        Matchmaking.Build(Req({ BodyId: User }), {
            Route: 'quick/search',
            Matchmaking: Service,
            userId: User,
        }).Body,
    ).Fields;
    const Second = Parse(
        Matchmaking.Build(Req({ BodyId: User }), {
            Route: 'quick/search',
            Matchmaking: Service,
            userId: User,
        }).Body,
    ).Fields;
    Assert.equal(GetU32(First, Crcs.ResultType), Results.InProgress);
    Assert.equal(GetU32(Second, Crcs.ResultType), Results.InProgress);
    Assert.equal(GetU64(First, Crcs.SearchSessionId), GetU64(Second, Crcs.SearchSessionId));
    Assert.equal(Service.Sessions.size, 1);
    Assert.equal(Service.Waiting.length, 1);
});

Test('HTTPS dispatcher serves the exact /mmg/quick/search and update URLs', async (T) => {
    const Root = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'granite-pno-mmg-'));
    T.after(() => Fs.rmSync(Root, { recursive: true, force: true }));
    const Config = {
        Host: '127.0.0.1',
        Port: 0,
        PublicHost: '203.0.113.10',
        WorldPort: 20054,
        RelayPort: 28091,
        RelaySessionPort: 0x2628,
        CertificateDirectory: Path.join(Root, 'certificate'),
        CaptureDirectory: Path.join(Root, 'captures'),
        UserContentDirectory: Path.join(Root, 'content'),
        SessionDirectory: Path.join(Root, 'sessions'),
        CdnDirectory: Path.join(Root, 'cdn'),
        EndpointTable: Path.resolve(__dirname, '../Storage/Session/Login/Endpoints2K19.json'),
        MaximumBodyBytes: 1024 * 1024,
    };
    const Instance = CreateGraniteServer(Config);
    await new Promise((Resolve) => Instance.Server.listen(0, '127.0.0.1', Resolve));
    T.after(() => new Promise((Resolve) => Instance.Server.close(Resolve)));
    const Port = Instance.Server.address().port;
    const Post = (Url, Input) =>
        new Promise((Resolve, Reject) => {
            const ReqValue = Https.request(
                {
                    host: '127.0.0.1',
                    port: Port,
                    path: Url,
                    method: 'POST',
                    rejectUnauthorized: false,
                    headers: {
                        'Content-Length': String(Input.Body.length),
                        VCFIELDLIST_SIZE: String(Input.Body.length),
                    },
                },
                (Incoming) => {
                    const Chunks = [];
                    Incoming.on('data', (Chunk) => Chunks.push(Chunk));
                    Incoming.on('end', () => Resolve(Buffer.concat(Chunks)));
                },
            );
            ReqValue.on('error', Reject);
            ReqValue.end(Input.Body);
        });

    const One = 76561198843023395n;
    const Two = 76561199290468632n;
    const Waiting = Parse(await Post('/nba/2k19/mmg/quick/search?x=pno-one', Req({ BodyId: One, Marker: 1 }))).Fields;
    Assert.equal(GetU32(Waiting, Crcs.ResultType), Results.InProgress);
    const Session = GetU64(Waiting, Crcs.SearchSessionId);

    const Paired = Parse(await Post('/nba/2k19/mmg/quick/search?x=pno-two', Req({ BodyId: Two, Marker: 2 }))).Fields;
    Assert.equal(GetU32(Paired, Crcs.ResultType), Results.Success);

    const Polled = Parse(
        await Post(
            '/nba/2k19/mmg/quick/update?x=pno-one',
            Req({ BodyId: One, SessionId: Session, Sequence: 5n, Marker: 1 }),
        ),
    ).Fields;
    Assert.equal(GetU32(Polled, Crcs.ResultType), Results.Success);
    Assert.equal(GetU64(Polled, Crcs.RecipientMachineId), One);
});

function PairedService() {
    const Service = Matchmaking.Create({ PublicHost: '127.0.0.1', RelayPort: 28091, RelayId: 0x2628 });
    const One = 76561198843023395n;
    const Two = 76561199290468632n;
    const Waiting = Parse(
        Matchmaking.Build(Req({ BodyId: One, Marker: 1 }), {
            Route: 'quick/search',
            Matchmaking: Service,
            userId: One,
        }).Body,
    ).Fields;
    Matchmaking.Build(Req({ BodyId: Two, Marker: 2 }), { Route: 'quick/search', Matchmaking: Service, userId: Two });
    const Match = Service.ByPlayer.get(One.toString()).Match;
    return { Service, One, Two, Match, Session: GetU64(Waiting, Crcs.SearchSessionId) };
}

function RemoveRequest(TicketId, MachineId) {
    const Built = new Builder().AddU64(Crcs.TicketId, TicketId).AddU64(Crcs.RecipientMachineId, MachineId).Build();
    return { Body: Built.Body, Parsed: Parse(Built.Body) };
}

Test('InterLockedUpdate is answered as update: same path, same ProcessServerResult callback', () => {
    const { Service, One } = PairedService();
    const Update = Parse(
        Matchmaking.Build(Req({ BodyId: One, Marker: 1 }), {
            Route: 'mmg/quick/update',
            Matchmaking: Service,
            userId: One,
        }).Body,
    ).Fields;
    const Interlocked = Parse(
        Matchmaking.Build(Req({ BodyId: One, Marker: 1 }), {
            Route: '/nba/2k19/mmg/quick/InterLockedUpdate',
            Matchmaking: Service,
            userId: One,
        }).Body,
    ).Fields;
    Assert.equal(GetU32(Interlocked, Crcs.ResultType), Results.Success);
    for (const Crc of [Crcs.TicketId, Crcs.Sequence, Crcs.RecipientMachineId]) {
        Assert.equal(GetU64(Interlocked, Crc), GetU64(Update, Crc));
    }
});

Test('remove drops the named machine from the match, never the machine asking', () => {
    const { Service, One, Two, Match } = PairedService();
    const Survivor = One < Two ? Two : One;
    const Departed = Survivor === One ? Two : One;

    const Reply = Parse(
        Matchmaking.Build(RemoveRequest(Match.TicketId, Departed), {
            Route: 'mmg/quick/remove',
            Matchmaking: Service,
            userId: Survivor,
        }).Body,
    ).Fields;
    Assert.equal(GetU32(Reply, Crcs.ResultType), Results.Success);
    Assert.ok(Service.ByPlayer.has(Survivor.toString()), 'the survivor keeps its session');
    Assert.ok(!Service.ByPlayer.has(Departed.toString()), "the departed machine's session is gone");
    Assert.equal(Match.LeaderMachineId, Survivor, 'the leader is recomputed over who is left');

    const After = Parse(
        Matchmaking.Build(Req({ BodyId: Survivor, Marker: 1 }), {
            Route: 'quick/update',
            Matchmaking: Service,
            userId: Survivor,
        }).Body,
    ).Fields;
    Assert.equal(GetU32(After, Crcs.ResultType), Results.Success);
    Assert.deepEqual(
        GetFields(After, Crcs.MachineIds, Types.U64).map((Field) => Field.value),
        [Survivor],
    );
    Assert.deepEqual(
        GetFields(After, Crcs.UserIds, Types.U64).map((Field) => Field.value),
        [Survivor],
    );
    Assert.equal(GetU64(After, Crcs.TicketId), Match.TicketId, 'same match, same ticket');
});

Test("remove is refused for yourself, a stranger, or another match's ticket", () => {
    const { Service, One, Two, Match } = PairedService();
    const Refused = (Ticket, Target, UserId) =>
        GetU32(
            Parse(
                Matchmaking.Build(RemoveRequest(Ticket, Target), {
                    Route: 'quick/remove',
                    Matchmaking: Service,
                    userId: UserId,
                }).Body,
            ).Fields,
            Crcs.ResultType,
        );
    Assert.equal(Refused(Match.TicketId, One, One), Results.BadRequest, 'IdOfMachineToRemove != OurMachineId');
    Assert.equal(Refused(Match.TicketId, 12345n, One), Results.BadRequest, 'not a member');
    Assert.equal(Refused(Match.TicketId ^ 1n, Two, One), Results.BadRequest, 'wrong ticket');
    Assert.equal(Match.Players.length, 2, 'nothing was removed');
});

Test('leave still removes the machine that sends it', () => {
    const { Service, One, Two } = PairedService();
    const Reply = Parse(
        Matchmaking.Build(Req({ BodyId: One, Marker: 1 }), {
            Route: 'mmg/quick/leave',
            Matchmaking: Service,
            userId: One,
        }).Body,
    ).Fields;
    Assert.equal(GetU32(Reply, Crcs.ResultType), Results.Success);
    Assert.ok(!Service.ByPlayer.has(One.toString()));
    Assert.ok(Service.ByPlayer.has(Two.toString()));
});
