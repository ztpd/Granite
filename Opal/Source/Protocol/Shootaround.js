// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Log = require('../Core/Log');
const { Hex } = require('../Core/Crc32');
const FieldList = require('../Codec/FieldList');
const ObjectFrame = require('../Codec/ObjectFrame');
const MyCourt = require('./MyCourt');
const PlayerObject = require('./PlayerObject');
const GotNext = require('./GotNext');
const Roster = require('./Roster');

const CourtClass = 0x2c4d49e3;
const CourtFlags = 116;
const CourtType = Object.freeze({ None: 0, OneVOne: 6, Couch: 27, Blacktop: 28, Shootaround: 29 });
const CourtTypeCount = 44;
const CourtTypeName = Object.freeze({
    0: 'NONE',
    1: 'FIVE_V_FIVE',
    2: 'FIVE_V_FIVE_GYM',
    3: 'FOUR_V_FOUR',
    4: 'THREE_V_THREE',
    5: 'TWO_V_TWO',
    6: 'ONE_V_ONE',
    7: 'ONE_V_ONE_QUICK',
    8: 'ONE_V_ONE_V_ONE',
    9: 'DUNK_CONTEST',
    10: 'THREE_PT_CONTEST',
    27: 'COUCH',
    28: 'BLACKTOP',
    29: 'SHOOTAROUND',
    30: 'SHOOTAROUND_PROAM',
    31: 'SLAMBALL_3V3',
    32: 'SLAMBALL_2V2',
    33: 'FREE_THROW_TOURNEY',
    34: 'HOUSE_RULES',
    35: 'COURT_CONQUEROR',
    36: 'THREE_V_THREE_PRO',
    37: 'RUFFLES_TOURNEY',
    38: 'BEST_OF_TEN',
    39: 'AROUND_THE_WORLD',
    40: 'PARTNER_SHOOTING',
    41: 'SEVEN_ON_BOARD',
    42: 'HORSE',
    43: 'SIGN_OUT',
});
const CourtIndex = 0x000d4d10;
const CourtBit = Object.freeze({
    Type: 0,
    CourtId: 2,
    SetupGate: 11,
    MatchId: 12,
    SecondTeamSize: 15,
    SecondTeam: 17,
    FirstTeamSize: 37,
    FirstTeam: 38,
});

const RequestPacket = 0xce148fb1;

const Command = 0xab153d7e;

const EndCommand = 0xdaeafe9e;

const RoomKeyOffset = 24;

const StateOffset = 51;
const GameIdOffset = 55;

const Field = Object.freeze({
    SoloFlag: 0x07bc2a56,
    Player: 0x190bbdbc,
    PlayerCount: 0xa8357302,
    GameSlot: 0xba4bba9d,
    Score: 0xd4d9ad7d,
    Result: 0xe3920695,
});

function Read(Bytes) {
    const CommandData = FieldList.Scan(Bytes, 'COMMAND');
    if (!CommandData || CommandData.Data1 >>> 0 !== Command >>> 0) return null;
    const At = FieldList.Locate(Bytes);
    if (At < 0) return null;
    const List = FieldList.Parse(Bytes, At);
    const Find = (Crc) => List.Fields.find((F) => F.Crc === Crc >>> 0) || null;
    const Solo = Find(Field.SoloFlag);
    const Count = Find(Field.PlayerCount);
    const Slot = Find(Field.GameSlot);
    const Players = List.Fields.filter((F) => F.Crc === Field.Player >>> 0 && F.Value !== undefined).map(
        (F) => F.Value,
    );
    if (!Solo || !Count || !Slot) return null;
    return {
        SoloFlag: Solo.Value,
        PlayerCount: Count.Value,
        GameSlot: Slot.Value,
        Players: Players,
        Fields: List.Fields.length,
    };
}

function Writable(Body) {
    if (!Buffer.isBuffer(Body) || Body.length < GameIdOffset + 4) return false;
    const Present = PlayerObject.PresentBits(Body, 16, 1);
    return [0, 1, 2, 3].every((Bit) => Present.includes(Bit));
}

function PatchPlayer(Connection, State, GameId) {
    if (!Writable(Connection.PlayerBody)) return false;
    const Body = Buffer.from(Connection.PlayerBody);
    Body.writeUInt32LE(State >>> 0, StateOffset);
    Body.writeUInt32LE(GameId >>> 0, GameIdOffset);
    Connection.PlayerBody = Body;
    return true;
}

function SendPlayer(Connection) {
    const Frame = PlayerObject.FrameFor(Connection);
    return !!Frame && !!Connection.SendObject(Frame);
}

function GrantPlaying(Connection, GameId) {
    if (!PatchPlayer(Connection, GotNext.State.Playing, GameId)) {
        Log.Error(
            `${Connection.Identifier} is starting a couch game but has no full player body to ` +
                `put PLAYING into, so the client will treat them as a spectator.`,
        );
        return false;
    }
    Connection.Shootaround = { GameId: GameId >>> 0, Since: Date.now() };
    return SendPlayer(Connection);
}

function Release(Connection) {
    if (!Connection || !Connection.Shootaround) return false;
    Connection.Shootaround = null;
    if (!PatchPlayer(Connection, GotNext.State.None, 0)) return false;
    return SendPlayer(Connection);
}

function Reapply(Connection) {
    if (!Connection || !Connection.Shootaround || !Writable(Connection.PlayerBody)) return false;
    if (Connection.PlayerBody.readUInt32LE(StateOffset) >>> 0 === GotNext.State.Playing >>> 0) return false;
    return PatchPlayer(Connection, GotNext.State.Playing, Connection.Shootaround.GameId);
}

function BuildCourt(ObjectId, Version, Players, Type = CourtType.Shootaround, Away = []) {
    const U32 = (Value) => {
        const Out = Buffer.alloc(4);
        Out.writeUInt32LE(Value >>> 0, 0);
        return Out;
    };
    const U64 = (Value) => {
        const Out = Buffer.alloc(8);
        Out.writeBigUInt64LE(BigInt.asUintN(64, BigInt(Value)), 0);
        return Out;
    };
    const Key = BigInt.asUintN(64, BigInt(ObjectId));
    const Team = Players.slice(0, 5).map((Player) => BigInt(Player));
    const Other = (Away || []).slice(0, 5).map((Player) => BigInt(Player));
    const Fields = new Map();
    Fields.set(CourtBit.Type, U32(Type));
    Fields.set(CourtBit.CourtId, U32(Number(Key & 0xffffffffn)));
    Fields.set(CourtBit.SetupGate, Buffer.from([0]));
    Fields.set(CourtBit.MatchId, U64(Key));
    Fields.set(CourtBit.SecondTeamSize, Buffer.from([Other.length]));
    Other.forEach((Player, Index) => Fields.set(CourtBit.SecondTeam + Index, U64(Player)));
    Fields.set(CourtBit.FirstTeamSize, Buffer.from([Team.length]));
    Team.forEach((Player, Index) => Fields.set(CourtBit.FirstTeam + Index, U64(Player)));

    const Bits = [...Fields.keys()].sort((A, B) => A - B);
    const Head = Buffer.alloc(16);
    Head.writeBigUInt64BE(Key, 0);
    Head.writeBigUInt64BE(BigInt(Version), 8);
    const Bitmap = Buffer.alloc(Math.ceil(CourtFlags / 8));
    for (const Bit of Bits) Bitmap[Bit >> 3] |= 0x80 >> (Bit & 7);
    const Payload = Buffer.concat([Head, Bitmap, ...Bits.map((Bit) => Fields.get(Bit))]);
    return ObjectFrame.Build({
        PacketId: MyCourt.ObjectDataPacket,
        ConnectionId: null,
        ObjectId: Key,
        ClassCrc: CourtClass,
        Payload,
        Layout: ObjectFrame.Layout.Nineteen,
    });
}

function CourtTypeFor(Game) {
    const Type = Number(Game && Game.GameSlot !== undefined ? Game.GameSlot : 0) >>> 0;
    return Type > 0 && Type < CourtTypeCount ? Type : CourtType.Shootaround;
}

function CourtTypeLabel(Type) {
    return CourtTypeName[Type] || `court type ${Type}`;
}

function TeamLabel(Team) {
    return Team.length
        ? Team.map((Id) => `0x${BigInt(Id).toString(16).toUpperCase().padStart(16, '0')}`).join(', ')
        : 'nobody';
}

function TeamsFor(Connection, Game, Type, Players) {
    if (Type === CourtType.Shootaround) {
        const Home = Players.map((Player) => Player.Puid)
            .filter((Puid) => Puid !== null && Puid !== undefined)
            .map((Puid) => BigInt(Puid));
        return { Home: Home.slice(0, 5), Away: [] };
    }
    const Ids = [];
    for (const Id of Game.Players || []) {
        const Value = BigInt(Id);
        if (!Ids.includes(Value)) Ids.push(Value);
    }
    const Own = Connection.Puid === null || Connection.Puid === undefined ? null : BigInt(Connection.Puid);
    if (Own !== null && !Ids.includes(Own)) Ids.unshift(Own);
    const Half = Math.ceil(Ids.length / 2);
    return { Home: Ids.slice(0, Math.min(Half, 5)), Away: Ids.slice(Half, Half + 5) };
}

function PlayersFor(Connection, Ids) {
    const Wanted = new Set((Ids || []).map((Id) => BigInt(Id)));
    const Players = [Connection];
    for (const Peer of Roster.Peers(Connection)) {
        if (Peer === Connection || !MyCourt.IsMyCourt(Peer)) continue;
        if (Peer.Puid === null || Peer.Puid === undefined || !Wanted.has(BigInt(Peer.Puid))) continue;
        Players.push(Peer);
    }
    return Players;
}

function ReadEnd(Bytes) {
    const CommandData = FieldList.Scan(Bytes, 'COMMAND');
    if (!CommandData || CommandData.Data1 >>> 0 !== EndCommand >>> 0) return null;
    const At = FieldList.Locate(Bytes);
    const List = At >= 0 ? FieldList.Parse(Bytes, At) : { Fields: [] };
    const Find = (Crc) => List.Fields.find((F) => F.Crc === Crc >>> 0) || null;
    const Score = Find(Field.Score);
    const Result = Find(Field.Result);
    return {
        Court: Bytes.length >= RoomKeyOffset + 8 ? Bytes.readBigUInt64BE(RoomKeyOffset) : null,
        Score: Score && Score.Value !== undefined ? Score.Value : null,
        Result: Result ? (Result.Data1 !== undefined ? Result.Data1 >>> 0 : Result.Value) : null,
    };
}

function HandleEnd(Connection, Bytes) {
    const End = ReadEnd(Bytes);
    if (!End || !MyCourt.IsMyCourt(Connection)) return false;
    Log.Info(
        `${Connection.Identifier} finished their MyCourt shootaround (result ` +
            `${End.Result === null ? 'unknown' : Hex(End.Result)}, score ${End.Score === null ? '?' : End.Score}) @ ${Log.Clock()}`,
    );

    Connection.Shootaround = null;
    const Walking = PatchPlayer(Connection, GotNext.State.None, 0) && SendPlayer(Connection);

    const CourtKey = End.Court !== null && End.Court !== 0n ? End.Court : Connection.ShootaroundCourtKey;
    let CourtVersion = null;
    if (CourtKey !== null && CourtKey !== undefined) {
        Connection.ShootaroundCourtVersion = (Connection.ShootaroundCourtVersion || 0n) + 1n;
        const Team =
            Connection.ShootaroundTeam && Connection.ShootaroundTeam.length
                ? Connection.ShootaroundTeam
                : [Connection.Puid].filter((Puid) => Puid !== null && Puid !== undefined);
        const Type =
            Connection.ShootaroundCourtType === undefined ? CourtType.Shootaround : Connection.ShootaroundCourtType;
        if (
            Connection.SendObject(
                BuildCourt(CourtKey, Connection.ShootaroundCourtVersion, Team, Type, Connection.ShootaroundAway || []),
            )
        ) {
            CourtVersion = Connection.ShootaroundCourtVersion;
        }
    }

    const Room = MyCourt.EndCribGame(
        Connection,
        Connection.ShootaroundRoomKey === undefined ? null : Connection.ShootaroundRoomKey,
    );
    Log.Verbose(
        `  player object ${Walking ? 'sent with WALKING and no game' : 'could not be put back to WALKING'}, ` +
            `court ${CourtKey === null || CourtKey === undefined ? 'unknown' : CourtKey.toString(16).toUpperCase()} ` +
            `${CourtVersion === null ? 'not re-sent' : `re-sent at version ${CourtVersion}`}, ` +
            `room ${Room ? `NONE at revision ${Room.Version}` : 'not found'}`,
    );
    return true;
}

function Handle(Connection, Bytes) {
    if (HandleEnd(Connection, Bytes)) return true;
    const Req = Read(Bytes);
    if (!Req) return false;
    if (!MyCourt.IsMyCourt(Connection)) return false;
    const Who = Req.Players.length
        ? Req.Players.map((P) => `0x${BigInt(P).toString(16).toUpperCase().padStart(16, '0')}`).join(', ')
        : '(no player ids)';
    const Type = CourtTypeFor(Req);
    Log.Info(
        `${Connection.Identifier} asked for a MyCourt ${CourtTypeLabel(Type)} ` +
            `(players ${Req.Players.length}, count ${Req.PlayerCount}, ` +
            `soloFlag ${Req.SoloFlag}, type ${Req.GameSlot}) @ ${Log.Clock()}`,
    );

    const ObjectId = Bytes.length >= RoomKeyOffset + 8 ? Bytes.readBigUInt64BE(RoomKeyOffset) : null;
    const RoomKey = ObjectId === null || ObjectId === 0n ? null : ObjectId;
    const Session =
        RoomKey !== null
            ? RoomKey >> 32n
            : Connection.SessionId === null || Connection.SessionId === undefined
              ? 0n
              : BigInt(Connection.SessionId);
    const CourtKey = (Session << 32n) | BigInt(CourtIndex);
    const GameId = CourtIndex >>> 0;
    const Players = PlayersFor(Connection, Req.Players);

    const Teams = TeamsFor(Connection, Req, Type, Players);
    Connection.ShootaroundCourtKey = CourtKey;
    Connection.ShootaroundCourtType = Type;
    Connection.ShootaroundTeam = Teams.Home;
    Connection.ShootaroundAway = Teams.Away;
    Connection.ShootaroundRoomKey = RoomKey;
    Connection.ShootaroundCourtVersion = (Connection.ShootaroundCourtVersion || 0n) + 1n;
    const Court = BuildCourt(CourtKey, Connection.ShootaroundCourtVersion, Teams.Home, Type, Teams.Away);
    let Courts = Connection.SendObject(Court) ? 1 : 0;
    for (const Peer of Roster.Peers(Connection)) {
        if (Peer !== Connection && MyCourt.IsMyCourt(Peer) && Peer.SendObject(Court)) Courts++;
    }

    let Playing = 0;
    for (const Player of Players) {
        if (GrantPlaying(Player, GameId)) Playing++;
    }

    const Room = MyCourt.StartCribGame(Connection, RoomKey, Req);
    if (!Room) {
        Log.Error(
            `${Connection.Identifier} asked for a couch game but no MyCourt room could be ` +
                `resolved for it, so the room was not put into SCRIMMAGE.`,
        );
        return true;
    }
    Log.Verbose(
        `  couch-game start ${Hex(Command)} from ${Who}: ${CourtTypeLabel(Type)} court ` +
            `${CourtKey.toString(16).toUpperCase()} (type ${Type}, home ${TeamLabel(Teams.Home)}, ` +
            `away ${TeamLabel(Teams.Away)}) to ${Courts}, ` +
            `${Playing} player object${Playing === 1 ? '' : 's'} with PLAYING and game ${Hex(GameId)}, ` +
            `room ${Room.ObjectId.toString(16).toUpperCase()} SCRIMMAGE at revision ${Room.Version}`,
    );
    return true;
}

module.exports = {
    Command,
    EndCommand,
    Field,
    RequestPacket,
    RoomKeyOffset,
    StateOffset,
    GameIdOffset,
    CourtClass,
    CourtFlags,
    CourtType,
    CourtTypeName,
    CourtIndex,
    CourtBit,
    BuildCourt,
    CourtTypeFor,
    TeamsFor,
    Read,
    ReadEnd,
    Handle,
    HandleEnd,
    GrantPlaying,
    Release,
    Reapply,
    PlayersFor,
};
