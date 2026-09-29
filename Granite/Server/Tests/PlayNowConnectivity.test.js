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
const { CreateGraniteServer } = require('../Source/Server');
const OpalLog = require('../../../Opal/Source/Core/Log');
const VconlineRelay = require('../../../Opal/Source/Net/VconlineRelay');
const PlayNow = require('../../../Opal/Source/Net/PlayNowPeer');

const { Crcs, Results } = Matchmaking;
const { Result } = PlayNow;
const RelayId = 0x2628;
const T0 = 1000;

function SearchBody({ userId: UserId, SessionId = 0n, Marker }) {
    const ListBuilder = new Builder()
        .AddU64(Crcs.UserIds, UserId)
        .AddBinary(Crcs.UserData, Buffer.from([0x78, 0xda, Marker]))
        .AddBinary(Crcs.MachineData, Buffer.alloc(32, Marker));
    if (SessionId) ListBuilder.AddU64(Crcs.SearchSessionId, SessionId);
    return ListBuilder.Build().Body;
}

function MatchFromReply(Body) {
    const { Fields } = Parse(Body);
    Assert.equal(GetU32(Fields, Crcs.ResultType), Results.Success);
    const TicketId = GetU64(Fields, Crcs.TicketId);
    const Sequence = GetU64(Fields, Crcs.Sequence);
    const OurMachineId = GetU64(Fields, Crcs.RecipientMachineId);
    Assert.ok(TicketId && Sequence && OurMachineId, 'ticket, sequence and recipient are each nonzero');
    const Relay = GetField(Fields, Crcs.RelayAddress, 0, Types.Packed);
    const Token = GetField(Fields, Crcs.RelayToken, 0, Types.Binary);
    const MachineIds = GetFields(Fields, Crcs.MachineIds, Types.U64).map((Field) => Field.value);
    Assert.ok(MachineIds.includes(OurMachineId), 'the recipient is one of the listed machines');
    const Ip = Relay.Data1 >>> 0;
    return new PlayNow.Match({
        TicketId,
        Sequence,
        OurMachineId,
        MachineIds,
        RelayToken: Buffer.from(Token.Raw),
        RelayHost: [Ip >>> 24, (Ip >>> 16) & 255, (Ip >>> 8) & 255, Ip & 255].join('.'),
        RelayPort: (Relay.Data2 >>> 16) & 0xffff,
        RelayId: Relay.Data2 & 0xffff,
    });
}

const Settle = () => new Promise((Resolve) => setTimeout(Resolve, 12));

function Pending(Peer, Type) {
    return Peer.Inbox.flatMap((Payload) => PlayNow.DecodeFrames(Payload)).filter((Frame) => Frame.Type === Type).length;
}

async function Drive(Peers, From, To, Step, { Expect = null } = {}) {
    const Trace = [];
    for (let Now = From; Now <= To; Now += Step) {
        await Settle();
        for (const Peer of Peers) {
            const { Received, Update } = Peer.Tick(Now);
            Trace.push({ Peer, Now, Update, Received });
            if (Expect) Expect(Peer, Now, Update, Received);
        }
    }
    await Settle();
    return Trace;
}

Test(
    'two Play Now players match through Granite, connect through Opal, and hold a leader/client session',
    async (T) => {
        OpalLog.SetLevel(OpalLog.Level.Error);
        const Root = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'granite-pno-connectivity-'));
        T.after(() => Fs.rmSync(Root, { recursive: true, force: true }));

        const RelaySocket = VconlineRelay.Start({ port: 0, host: '127.0.0.1' });
        await new Promise((Resolve) => {
            try {
                RelaySocket.address();
                Resolve();
            } catch {
                RelaySocket.once('listening', Resolve);
            }
        });
        const RelayPort = RelaySocket.address().port;
        T.after(() => VconlineRelay.Stop());

        const Instance = CreateGraniteServer({
            Host: '127.0.0.1',
            Port: 0,
            PublicHost: '127.0.0.1',
            WorldPort: 20054,
            RelayPort: RelayPort,
            RelaySessionPort: RelayId,
            CertificateDirectory: Path.join(Root, 'certificate'),
            CaptureDirectory: Path.join(Root, 'captures'),
            UserContentDirectory: Path.join(Root, 'content'),
            SessionDirectory: Path.join(Root, 'sessions'),
            CdnDirectory: Path.join(Root, 'cdn'),
            EndpointTable: Path.resolve(__dirname, '../Storage/Session/Login/Endpoints2K19.json'),
            MaximumBodyBytes: 1024 * 1024,
        });
        await new Promise((Resolve) => Instance.Server.listen(0, '127.0.0.1', Resolve));
        T.after(() => new Promise((Resolve) => Instance.Server.close(Resolve)));
        const HttpsPort = Instance.Server.address().port;
        const Post = (Route, Tag, Body) =>
            new Promise((Resolve, Reject) => {
                const Req = Https.request(
                    {
                        host: '127.0.0.1',
                        port: HttpsPort,
                        path: `/nba/2k19/mmg/quick/${Route}?x=${Tag}`,
                        method: 'POST',
                        rejectUnauthorized: false,
                        headers: { 'Content-Length': String(Body.length), VCFIELDLIST_SIZE: String(Body.length) },
                    },
                    (Incoming) => {
                        const Chunks = [];
                        Incoming.on('data', (Chunk) => Chunks.push(Chunk));
                        Incoming.on('end', () => Resolve(Buffer.concat(Chunks)));
                    },
                );
                Req.on('error', Reject);
                Req.end(Body);
            });

        const One = 76561198843023395n;
        const Two = 76561199290468632n;

        const Waiting = Parse(await Post('search', 'one', SearchBody({ userId: One, Marker: 1 }))).Fields;
        Assert.equal(GetU32(Waiting, Crcs.ResultType), Results.InProgress);
        const Session = GetU64(Waiting, Crcs.SearchSessionId);

        const Replies = {
            TwoSearch: await Post('search', 'two', SearchBody({ userId: Two, Marker: 2 })),
            OneSearch: await Post('search', 'one', SearchBody({ userId: One, SessionId: Session, Marker: 1 })),
        };
        Replies.OneUpdate = await Post('update', 'one', SearchBody({ userId: One, SessionId: Session, Marker: 1 }));
        Replies.TwoUpdate = await Post('update', 'two', SearchBody({ userId: Two, Marker: 2 }));

        const Matches = Object.fromEntries(Object.entries(Replies).map(([Key, Body]) => [Key, MatchFromReply(Body)]));
        for (const Match of Object.values(Matches)) {
            Assert.equal(Match.TicketId, Matches.TwoSearch.TicketId, 'one ticket');
            Assert.equal(
                Match.Sequence,
                Matches.TwoSearch.Sequence,
                'one sequence for every recipient, from search and from update alike',
            );
            Assert.deepEqual(Match.RelayToken, Matches.TwoSearch.RelayToken, 'one relay token');
            Assert.deepEqual(Match.Machines, Matches.TwoSearch.Machines, 'one machine list');
            Assert.equal(Match.RelayPort, RelayPort);
            Assert.equal(Match.LeaderMachineId, One < Two ? One : Two);
        }

        const Players = [Matches.OneUpdate, Matches.TwoUpdate].map((Match) => new PlayNow.Peer(Match));
        T.after(() => Players.forEach((Peer) => Peer.Close()));
        await Promise.all(Players.map((Peer) => Peer.Connect({ PollMs: 200 })));
        const Leader = Players.find((Peer) => Peer.Match.OurMachineId === Peer.Match.LeaderMachineId);
        const Client = Players.find((Peer) => Peer !== Leader);
        Assert.ok(Leader && Client, 'exactly one of the two derives that it leads');
        for (const Peer of Players) Peer.Connectivity.NewMatchState(Peer.Match.Machines, T0);

        await Drive(Players, T0, T0 + 12, 0.5, {
            Expect: (Peer, NowValue, Update, Received) => {
                Assert.equal(
                    Update,
                    Result.Success,
                    `${Peer === Leader ? 'leader' : 'client'} update at +${NowValue - T0}`,
                );
                for (const { Result: Outcome } of Received) {
                    Assert.equal(
                        Outcome,
                        Result.Success,
                        `${Peer === Leader ? 'leader' : 'client'} frame at +${NowValue - T0}`,
                    );
                }
            },
        });
        Assert.ok(Leader.Connectivity.Sent.Leader >= 12, 'the leader broadcast a heartbeat every second');
        Assert.equal(
            Client.Connectivity.Received.Leader + Pending(Client, PlayNow.FrameType.Leader),
            Leader.Connectivity.Sent.Leader,
            'every heartbeat crossed the relay to the client',
        );
        Assert.ok(Leader.Connectivity.Received.Connectivity > 0, 'the leader heard the client');
        Assert.equal(
            Leader.Connectivity.Received.Connectivity + Pending(Leader, PlayNow.FrameType.Connectivity),
            Client.Connectivity.Sent.Connectivity,
            'every connectivity frame crossed the relay to the leader',
        );
        Assert.deepEqual(Leader.Errors, []);
        Assert.deepEqual(Client.Errors, []);

        const OldLeader = Leader.Match.OurMachineId;
        const LastHeardFromLeader = Client.Connectivity.Nodes.get(OldLeader).LastConnectivity;
        Leader.Close();

        let Now = T0 + 12.5;
        let SawWaiting = false;
        for (; Now <= T0 + 60 && Client.Match.LeaderMachineId === OldLeader; Now += 0.5) {
            await Settle();
            const { Update } = Client.Tick(Now);
            if (Update === Result.WaitingForEcho) SawWaiting = true;
            else Assert.equal(Update, Result.Success, `client update at +${Now - T0}`);
        }
        const TookOverAt = Now - 0.5;

        Assert.ok(SawWaiting, 'the client ran its echo self-test');
        Assert.ok(
            Client.Connectivity.Received.Echo >= PlayNow.Timing.EchoesBeforeRemovingLeader,
            "the client's self-addressed echoes came back through Opal",
        );
        Assert.equal(Client.Match.LeaderMachineId, Client.Match.OurMachineId, 'the client took over leadership');
        Assert.ok(
            TookOverAt - LastHeardFromLeader > PlayNow.Timing.MissingHeartbeatSeconds,
            'not before the leader had been silent MAX_MISSING_HEARTBEAT_SECONDS',
        );
        Assert.deepEqual(Client.Match.RemoveRequests, [
            { MachineId: OldLeader, Reason: PlayNow.RemoveReason.LeaderLostAfterEcho },
        ]);
        Assert.equal(Client.Connectivity.Sent.Leave, 1);
        Assert.deepEqual(Client.Errors, []);

        const [Removal] = Client.Match.RemoveRequests;
        const Asking = new Builder()
            .AddU64(Crcs.TicketId, Client.Match.TicketId)
            .AddU64(Crcs.RecipientMachineId, Removal.MachineId)
            .AddU64(Crcs.UserIds, Client.Match.OurMachineId)
            .Build().Body;
        const Removed = Parse(await Post('remove', 'survivor', Asking)).Fields;
        Assert.equal(GetU32(Removed, Crcs.ResultType), Results.Success);

        const Synced = MatchFromReply(
            await Post('InterLockedUpdate', 'survivor', SearchBody({ userId: Client.Match.OurMachineId, Marker: 2 })),
        );
        Assert.equal(Synced.TicketId, Client.Match.TicketId, 'still the same match');
        Assert.equal(Synced.Sequence, Client.Match.Sequence);
        Assert.deepEqual(Synced.Machines, [Client.Match.OurMachineId], 'the departed leader is gone from the reply');
        Assert.equal(Synced.LeaderMachineId, Client.Match.OurMachineId);
        const Resynced = new PlayNow.Connectivity(Synced, {
            SendToList: () => Result.Success,
            Broadcast: () => Result.Success,
        });
        Resynced.NewMatchState(Synced.Machines, TookOverAt);
        Assert.equal(Resynced.Nodes.has(OldLeader), false);

        let Ended = null;
        for (Now = TookOverAt + 0.5; Now <= TookOverAt + 30 && Ended === null; Now += 0.5) {
            await Settle();
            const { Update } = Client.Tick(Now);
            if (Update === Result.NoTrafficAsLeader) Ended = Now;
            else Assert.equal(Update, Result.Success, `lone leader update at +${Now - T0}`);
        }
        Assert.ok(Ended !== null, 'the lone leader ends its session');
        Assert.equal(Client.Connectivity.Fatal, Result.NoTrafficAsLeader);
        Assert.equal(Client.Connectivity.Received.Leave, 1, 'the Leave broadcast came back to its sender');
        const LastPacket = Client.Connectivity.LastPacketAt;
        Assert.ok(LastPacket > TookOverAt, 'the returned Leave arrived after the takeover');
        Assert.ok(
            Ended - LastPacket >= PlayNow.Timing.MissingHeartbeatSeconds &&
                Ended - LastPacket < PlayNow.Timing.MissingHeartbeatSeconds + 0.5,
            'exactly MAX_MISSING_HEARTBEAT_SECONDS after the last packet it received',
        );
    },
);
