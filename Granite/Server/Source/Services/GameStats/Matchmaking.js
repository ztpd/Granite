// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Crypto = require('node:crypto');
const Logger = require('../../Core/Logger');
const { Builder, Types, GetField, GetU64 } = require('../../Codec/FieldList');

const Crcs = Object.freeze({
    Command: 0x5bb78c48,
    Sequence: 0x1780ec1f,
    SearchSessionId: 0x198838a6,
    TicketId: 0xd4c0767a,
    PacketVersion: 0x1dee499c,
    MatchKind: 0x2a6acaad,
    NetworkKind: 0x87e5bc62,
    RelayAddress: 0x6cd5d4f9,
    RelayToken: 0xae6eea84,
    RecipientMachineId: 0xc56500f9,
    MachineData: 0x3f71955d,
    MachineIds: 0x92cd7d5b,
    MachinePuCounts: 0x8c9ef2cf,
    UserIds: 0x3a60fe52,
    UserData: 0x9ad3e8f7,
    UserFlags: 0x61e5e2ac,
    RetrySeconds: 0xf8dc9086,
    Ttl: 0x0bb02c05,
    ResultType: 0xe3920695,
});

const Results = Object.freeze({
    Success: 0x504521a8,
    InProgress: 0xcbc811f2,
    BadRequest: 0x135e11fb,
});

const Constants = Object.freeze({
    PacketVersion: 0x92e56e10,
    MatchKind: 0x1a236ec5,
    NetworkKind: 0,
    RetrySeconds: 2,
    MatchSequence: 5,
    DefaultRelayPort: 28091,
    DefaultRelayId: 0x2628,
    EntryLifetimeMs: 5 * 60 * 1000,
});

function RouteName(Value) {
    const Route = String(Value || '')
        .toLowerCase()
        .replace(/\\/g, '/')
        .split('?')[0];
    const Is = (Name) => Route.endsWith(`/quick/${Name}`) || Route === `quick/${Name}`;
    if (Is('search')) return 'quick/search';
    if (Is('update')) return 'quick/update';
    if (Is('interlockedupdate')) return 'quick/interlockedupdate';
    if (Is('remove')) return 'quick/remove';
    if (Is('leave')) return 'quick/leave';
    return Route;
}

function IdentityU64(Value) {
    if (Value === null || Value === undefined || Value === '') return 0n;
    try {
        return BigInt.asUintN(64, BigInt(Value));
    } catch {
        const Digest = Crypto.createHash('sha256').update(String(Value)).digest();
        return Digest.readBigUInt64BE(0) | 0x4000000000000000n;
    }
}

function Bytes(Fields, Crc, Index = 0) {
    const Field = GetField(Fields, Crc, Index, Types.Binary);
    return Field && Buffer.isBuffer(Field.value) ? Buffer.from(Field.value) : Buffer.alloc(0);
}

function Ipv4Word(Address) {
    const Octets = String(Address || '')
        .trim()
        .split('.')
        .map(Number);
    if (Octets.length !== 4 || Octets.some((Value) => !Number.isInteger(Value) || Value < 0 || Value > 255)) {
        throw new Error(`Play Now relay host must be an IPv4 address, received ${Address || '<empty>'}`);
    }
    return ((Octets[0] << 24) | (Octets[1] << 16) | (Octets[2] << 8) | Octets[3]) >>> 0;
}

function NonzeroRandomU64(RandomBytes) {
    let Value = 0n;
    while (!Value) Value = RandomBytes(8).readBigUInt64BE(0);
    return Value;
}

function NonzeroToken(RandomBytes) {
    let Value = Buffer.alloc(16);
    while (Value.equals(Buffer.alloc(16))) Value = Buffer.from(RandomBytes(16));
    return Value;
}

function RequestSessionId(Fields) {
    return GetU64(Fields, Crcs.SearchSessionId) || 0n;
}

function DerivePlayer(Input, Context = {}) {
    const Fields = Input?.Parsed?.Fields || [];
    const BodyId = GetU64(Fields, Crcs.UserIds) || 0n;
    let Id = IdentityU64(Context.userId) || BodyId;
    if (!Id) Id = IdentityU64(Context.SessionKey || Context.gamertag || Input?.Body?.toString('hex'));
    if (!Id) throw new Error('Play Now search has no usable authenticated identity');
    return {
        id: Id,
        key: Id.toString(),
        gamertag: String(Context.gamertag || ''),
        UserData: Bytes(Fields, Crcs.UserData),
        MachineData: Bytes(Fields, Crcs.MachineData),
    };
}

function InProgress(Session) {
    return new Builder()
        .AddU64(Crcs.RetrySeconds, BigInt(Constants.RetrySeconds))
        .AddU64(Crcs.SearchSessionId, Session.id)
        .AddF32(Crcs.Ttl, Constants.RetrySeconds)
        .AddU32(Crcs.ResultType, Results.InProgress)
        .Build();
}

function BadRequest() {
    return new Builder().AddU32(Crcs.ResultType, Results.BadRequest).Build();
}

function Success(Match, Recipient, Options) {
    const PackedPorts = (((Options.RelayPort & 0xffff) << 16) | (Match.RelayId & 0xffff)) >>> 0;
    const ListBuilder = new Builder()
        .AddU64(Crcs.TicketId, Match.TicketId)
        .AddU64(Crcs.Sequence, Match.Sequence)
        .AddU64(Crcs.RecipientMachineId, Recipient.Player.id)
        .AddU32(Crcs.PacketVersion, Constants.PacketVersion)
        .AddU32(Crcs.MatchKind, Constants.MatchKind)
        .AddU32(Crcs.NetworkKind, Constants.NetworkKind)
        .AddPacked(Crcs.RelayAddress, Options.RelayIp, PackedPorts)
        .AddBinary(Crcs.RelayToken, Match.RelayToken);

    if (Match.Players.every((Player) => Player.MachineData.length)) {
        for (const Player of Match.Players) ListBuilder.AddBinary(Crcs.MachineData, Player.MachineData);
    }

    for (const Player of Match.Players) ListBuilder.AddU64(Crcs.MachineIds, Player.id);
    for (const Player of Match.Players) ListBuilder.AddU64(Crcs.MachinePuCounts, 1n);
    for (const Player of Match.Players) ListBuilder.AddU64(Crcs.UserIds, Player.id);

    if (Match.Players.every((Player) => Player.UserData.length)) {
        for (const Player of Match.Players) ListBuilder.AddBinary(Crcs.UserData, Player.UserData);
    }
    for (const Player of Match.Players) ListBuilder.AddU64(Crcs.UserFlags, 0n);

    return ListBuilder.AddF32(Crcs.Ttl, 30).AddU32(Crcs.ResultType, Results.Success).Build();
}

class Matchmaker {
    constructor(Options = {}) {
        this.RandomBytes = Options.RandomBytes || Crypto.randomBytes;
        this.Now = Options.Now || Date.now;
        this.Options = {
            RelayIp: Ipv4Word(Options.PublicHost || '127.0.0.1'),
            RelayPort: Number(Options.RelayPort || Constants.DefaultRelayPort),
            RelayId: Number(Options.RelayId || Constants.DefaultRelayId),
        };
        if (
            !Number.isInteger(this.Options.RelayPort) ||
            this.Options.RelayPort < 1 ||
            this.Options.RelayPort > 0xffff
        ) {
            throw new Error('Play Now relay port must be in the range 1..65535');
        }
        if (!Number.isInteger(this.Options.RelayId) || this.Options.RelayId < 1 || this.Options.RelayId > 0xffff) {
            throw new Error('Play Now relay id must be in the range 1..65535');
        }
        this.Sessions = new Map();
        this.ByPlayer = new Map();
        this.Waiting = [];
    }

    Prune() {
        const Oldest = this.Now() - Constants.EntryLifetimeMs;
        for (const Session of this.Sessions.values()) {
            if (Session.TouchedAt < Oldest) this.Remove(Session);
        }
    }

    Remove(Session) {
        if (!Session) return;
        this.Sessions.delete(Session.id.toString());
        if (this.ByPlayer.get(Session.Player.key) === Session) this.ByPlayer.delete(Session.Player.key);
        this.Waiting = this.Waiting.filter((Candidate) => Candidate !== Session);
    }

    Locate(Fields, Player) {
        const Requested = RequestSessionId(Fields);
        if (Requested) {
            const ById = this.Sessions.get(Requested.toString());
            if (ById && ById.Player.key === Player.key) return ById;
        }
        return this.ByPlayer.get(Player.key) || null;
    }

    Create(Player) {
        const Session = {
            id: NonzeroRandomU64(this.RandomBytes),
            Player,
            Match: null,
            TouchedAt: this.Now(),
        };
        this.Sessions.set(Session.id.toString(), Session);
        this.ByPlayer.set(Player.key, Session);
        this.Waiting.push(Session);
        return Session;
    }

    Refresh(Session, Player) {
        Session.TouchedAt = this.Now();
        if (Player.UserData.length) Session.Player.UserData = Player.UserData;
        if (Player.MachineData.length) Session.Player.MachineData = Player.MachineData;
        if (Player.gamertag) Session.Player.gamertag = Player.gamertag;
    }

    Pair(Session) {
        if (Session.Match) return Session.Match;
        const Peer = this.Waiting.find(
            (Candidate) => Candidate !== Session && !Candidate.Match && Candidate.Player.key !== Session.Player.key,
        );
        if (!Peer) return null;
        const Players = [Peer.Player, Session.Player].sort((Left, Right) =>
            Left.id < Right.id ? -1 : Left.id > Right.id ? 1 : 0,
        );
        const Match = {
            TicketId: NonzeroRandomU64(this.RandomBytes),
            RelayToken: NonzeroToken(this.RandomBytes),
            RelayId: this.Options.RelayId,
            Players,
            LeaderMachineId: Players[0].id,
            Sequence: BigInt(Constants.MatchSequence),
        };
        Peer.Match = Match;
        Session.Match = Match;
        Peer.TouchedAt = Session.TouchedAt = this.Now();
        this.Waiting = this.Waiting.filter((Candidate) => Candidate !== Peer && Candidate !== Session);
        Logger.Info(
            `Play Now matched ${Peer.Player.id} with ${Session.Player.id}; ` +
                `leader ${Match.LeaderMachineId}, relay id ${Match.RelayId}, ` +
                `ticket 0x${Match.TicketId.toString(16).toUpperCase()}`,
        );
        return Match;
    }

    Search(Input, Context = {}) {
        this.Prune();
        const Fields = Input?.Parsed?.Fields || [];
        let Player;
        try {
            Player = DerivePlayer(Input, Context);
        } catch (Failure) {
            Logger.Error('Play Now search rejected', Failure);
            return BadRequest();
        }
        let Session = this.Locate(Fields, Player);
        if (!Session) Session = this.Create(Player);
        else this.Refresh(Session, Player);
        const Match = Session.Match || this.Pair(Session);
        if (!Match) {
            Logger.Verbose(
                `Play Now search waiting for peer: user ${Player.id}, ` +
                    `session 0x${Session.id.toString(16).toUpperCase()}`,
            );
            return InProgress(Session);
        }
        return Success(Match, Session, this.Options);
    }

    Update(Input, Context = {}) {
        this.Prune();
        const Fields = Input?.Parsed?.Fields || [];
        let Player;
        try {
            Player = DerivePlayer(Input, Context);
        } catch (Failure) {
            Logger.Error('Play Now update rejected', Failure);
            return BadRequest();
        }
        const Session = this.Locate(Fields, Player);
        if (!Session) return BadRequest();
        this.Refresh(Session, Player);
        const Match = Session.Match || this.Pair(Session);
        if (!Match) return InProgress(Session);
        return Success(Match, Session, this.Options);
    }

    RemoveMachine(Input, Context = {}) {
        const Fields = Input?.Parsed?.Fields || [];
        let Requester;
        try {
            Requester = DerivePlayer(Input, Context);
        } catch {
            return BadRequest();
        }
        const Session = this.Locate(Fields, Requester);
        const Match = Session?.Match;
        const TicketId = GetU64(Fields, Crcs.TicketId) || 0n;
        const Target = GetU64(Fields, Crcs.RecipientMachineId) || 0n;
        if (!Match || !TicketId || Match.TicketId !== TicketId) {
            Logger.Verbose(`Play Now remove refused: no match for ticket 0x${TicketId.toString(16).toUpperCase()}`);
            return BadRequest();
        }
        const Departed = Match.Players.find((Player) => Player.id === Target);
        if (!Target || !Departed || Target === Requester.id) {
            Logger.Verbose(`Play Now remove refused: machine ${Target} is not another member of the match`);
            return BadRequest();
        }
        Match.Players = Match.Players.filter((Player) => Player !== Departed);
        Match.LeaderMachineId =
            Match.Players.reduce((Low, Player) => (Low === null || Player.id < Low ? Player.id : Low), null) ?? 0n;
        this.Remove(this.ByPlayer.get(Departed.key));
        Logger.Info(
            `Play Now removed ${Departed.id} from ticket 0x${TicketId.toString(16).toUpperCase()} ` +
                `at ${Requester.id}'s request; leader ${Match.LeaderMachineId}`,
        );
        return new Builder().AddU32(Crcs.ResultType, Results.Success).Build();
    }

    Leave(Input, Context = {}) {
        let Player;
        try {
            Player = DerivePlayer(Input, Context);
        } catch {
            return BadRequest();
        }
        const Session = this.Locate(Input?.Parsed?.Fields || [], Player);
        this.Remove(Session);
        return new Builder().AddU32(Crcs.ResultType, Results.Success).Build();
    }
}

function Create(Options) {
    return new Matchmaker(Options);
}

let Fallback = null;
function Build(Input, Context = {}) {
    const Service =
        Context.Matchmaking ||
        (Fallback ||= Create({
            PublicHost: Context.PublicHost || '127.0.0.1',
            RelayPort: Context.RelayPort,
            RelayId: Context.RelayId,
        }));
    const Route = RouteName(Context.Route);
    if (Route === 'quick/search') return Service.Search(Input, Context);
    if (Route === 'quick/update' || Route === 'quick/interlockedupdate') return Service.Update(Input, Context);
    if (Route === 'quick/remove') return Service.RemoveMachine(Input, Context);
    if (Route === 'quick/leave') return Service.Leave(Input, Context);
    return new Builder().AddU32(Crcs.ResultType, Results.Success).Build();
}

function Reset() {
    Fallback = null;
}

module.exports = {
    Build,
    Matchmaking: Build,
    Create,
    Matchmaker,
    Reset,
    RouteName,
    DerivePlayer,
    Ipv4Word,
    Crcs,
    Results,
    Constants,
    Status: 'NBA2K19_IDA_VALIDATED_QUICK_MATCHMAKING',
};
