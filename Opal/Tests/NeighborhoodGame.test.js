// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';
const Test = require('node:test');
const Assert = require('node:assert/strict');
const Fs = require('node:fs');
const Path = require('node:path');
const Zlib = require('node:zlib');
const Court = require('../Source/Protocol/CourtData');
const GotNext = require('../Source/Protocol/GotNext');
const Roster = require('../Source/Protocol/Roster');
const Slots = require('../Source/Protocol/Slots');
const Courts = require('../Source/Protocol/Courts');
const Tables = require('../Source/Activity/CourtTables');
const { BoulevardCourts } = require('../Source/Activity/StageSpots/BoulevardCourts2K19');
const FieldList = require('../Source/Codec/FieldList');
const Frame = require('../Source/Codec/Frame');
const Player = require('../Source/Protocol/PlayerObject');
const Body = require('../Source/Protocol/PlayerBody');
const Position = require('../Source/Protocol/Position');
const Userdata = require('../Source/Protocol/Userdata');
require('../Source/Core/Log').SetLevel(0);

function Decode(FrameData) {
    Assert.equal(FrameData.readUInt32LE(), FrameData.length);
    Assert.equal(FrameData.readUInt32BE(24), 0x2c4d49e3);
    Assert.equal(FrameData.readUInt32BE(28), FrameData.length - 32);
    const B = FrameData.subarray(32),
        Fields = new Map();
    let At = 31;
    for (let Bit = 0; Bit < 116; Bit++) {
        if (!(B[16 + (Bit >> 3)] & (0x80 >> (Bit & 7)))) continue;
        let Size;
        if ([0, 2, 13, 67, 70, 102].includes(Bit)) Size = 4;
        else if ([65, 66, 68, 69, 101].includes(Bit)) Size = 16;
        else if ([103, 104].includes(Bit)) Size = 2;
        else if (Bit === 1) Size = 64;
        else if ([11, 15, 37, 58, 108].includes(Bit)) Size = 1;
        else if (Bit === 12 || (Bit >= 17 && Bit <= 21) || (Bit >= 38 && Bit <= 42)) Size = 8;
        else if ((Bit >= 32 && Bit <= 36) || (Bit >= 53 && Bit <= 57)) Size = 4 + B.readUInt32LE(At);
        else if (Bit >= 59 && Bit <= 61) Size = 72;
        else if (Bit >= 62 && Bit <= 64) Size = 144;
        else Assert.fail(`unexpected native court bit ${Bit}`);
        Assert.ok(At + Size <= B.length);
        Fields.set(Bit, B.subarray(At, At + Size));
        At += Size;
    }
    Assert.equal(At, B.length, 'decoder consumes the complete payload');
    return Fields;
}

function RecapPoints(Fields, Bits, Count) {
    const Vec = (Value) => [0, 4, 8].map((Offset) => Value.readFloatLE(Offset));
    const Base = Vec(Fields.get(Bits[0])),
        Step = Vec(Fields.get(Bits[1]));
    return {
        Points: Array.from({ length: Count }, (_, I) => Base.map((Value, Axis) => Value + Step[Axis] * I)),
        Facing: Fields.get(Bits[2]).readInt32LE(),
    };
}

function AssertNear(Actual, Expected, Message) {
    Actual.forEach((Value, Axis) =>
        Assert.ok(Math.abs(Value - Expected[Axis]) < 0.01, `${Message}: [${Actual}] vs [${Expected}]`),
    );
}

Test('every Boulevard court frame carries recap winner/loser lines ending on the post-game spots', () => {
    const World = Tables.For('neighborhood');
    for (const Entry of BoulevardCourts) {
        const Raw = World.Courts.find((CourtValue) => CourtValue.Name === Entry.name);
        const Found = {
            Raw,
            Groups: Courts.GroupsFor(Raw, World.Room, World.SeqBase).filter((G) => G.Kind === 'gotnext'),
        };
        for (const { Frame: FrameData } of [
            Court.BuildParkCourt(Entry),
            Court.BuildParkCourtOccupancy(Entry),
            Court.BuildParkCourtMirror(Entry),
        ]) {
            const Fields = Decode(FrameData);
            const Winners = RecapPoints(Fields, [65, 66, 67], Raw.TeamSize);
            const Losers = RecapPoints(Fields, [68, 69, 70], Raw.TeamSize);
            for (let I = 0; I < Raw.TeamSize; I++) {
                AssertNear(Winners.Points[I], GotNext.WinnerPoint(Raw, I), `${Entry.name} winner ${I}`);
                AssertNear(Losers.Points[I], GotNext.LoserPoint(Found, I, Raw.TeamSize), `${Entry.name} loser ${I}`);
            }
            Assert.deepEqual(
                Winners.Points[0].map(Math.round),
                Raw.Pos.map(Math.round),
                'the recap walks the first winner to the court centre, not the world origin',
            );
            Assert.equal(
                Losers.Facing,
                Math.round(Position.FacingUnitsForSpot(GotNext.LoserPoint(Found, 0, Raw.TeamSize), Raw.Pos)),
                'losers face the court',
            );
        }
    }
});

const Captured = Player.ExtractHandshakeBody(
    Buffer.from(
        Fs.readFileSync(Path.join(__dirname, 'Frames/Handshake2K19.txt'), 'utf8').trim().split(/\s+/)[3],
        'hex',
    ),
);
let NextId = 6000;
function ProfileFrame(Profile) {
    return Frame.Build(
        0x9e3471ed,
        Buffer.alloc(8),
        new FieldList.Builder()
            .AddBlob('COMPRESSED_DATA', Zlib.deflateSync(Profile))
            .AddU32('COMMAND', Userdata.UserdataCommand)
            .Build(),
        Frame.InnerHeader.Object,
    );
}
function Setup(Entry, Events) {
    Court.ClearGameTeams('neighborhood', Entry.name);
    const World = Tables.For('neighborhood'),
        Raw = World.Courts.find((C) => C.Name === Entry.name);
    const Groups = Courts.GroupsFor(Raw, World.Room, World.SeqBase).filter((G) => G.Kind === 'gotnext');
    const Players = [];
    for (let Side = 0; Side < 2; Side++)
        for (let Seat = 0; Seat < Entry.TeamSize; Seat++) {
            const Id = NextId++,
                Puid = 0x0110000100000000n + BigInt(Id);
            const P = {
                Id: Id,
                Puid: Puid,
                State: 2,
                MachineId: BigInt(Id),
                ActivityName: 'neighborhood',
                ActivityKey: 0x3cf672c2,
                Identifier: String(Id),
                PlayerRevision: 1n,
                PlayerBody: Player.StampIdentity(Captured.Body, Captured.PlayerId, Puid).Body,
                GotNext: { Court: Groups[Side].ObjectId, Slot: Side },
                Userdata: ProfileFrame(Buffer.alloc(223256, Id & 255)),
                VconlineProfileReady: true,
                Send(FrameData) {
                    Events.push({ To: Id, Frame: FrameData });
                    return true;
                },
                SendObject(FrameData) {
                    Events.push({ To: Id, Frame: FrameData });
                    return true;
                },
            };
            P.StateOffset = Body.Decode(P.PlayerBody).Offsets.get(2);
            P.PlayerBody.writeUInt32LE(GotNext.State.GotNext, P.StateOffset);
            Slots.Occupy(Groups[Side].SlotObjectId, Puid, Entry.TeamSize, Seat);
            Roster.Add(P);
            Players.push(P);
        }
    return {
        Players,
        Groups,
        Raw,
        Cleanup() {
            for (const P of Players) {
                Slots.Release(P.Puid);
                Roster.Remove(P);
            }
            Court.ClearGameTeams('neighborhood', Entry.name);
        },
    };
}
function Command(Entry, Value = 0xdfc1471f) {
    const B = Buffer.alloc(68);
    B.writeUInt32LE(68);
    B.writeUInt32BE(0xce148fb1, 4);
    B.writeUInt32BE(23, 20);
    B.writeBigUInt64BE(BigInt(Entry.id), 24);
    B.writeUInt32BE(0xb18f14ce, 36);
    B.writeUInt32BE(0x1423add2, 40);
    B.writeUInt32BE(Value, 44);
    return B;
}
function EndCommand(Entry, Result, Score = 0) {
    const List = new FieldList.Builder()
        .AddU32('COMMAND', GotNext.EndCommand)
        .AddU32(GotNext.EndField.Score, Score)
        .AddU32(GotNext.EndField.Result, Result)
        .Build();
    const B = Buffer.alloc(36 + List.length);
    B.writeUInt32LE(B.length);
    B.writeUInt32BE(0xce148fb1, 4);
    B.writeUInt32BE(77, 20);
    B.writeBigUInt64BE(BigInt(Entry.id), 24);
    B.writeUInt32BE(List.length, 32);
    List.copy(B, 36);
    return B;
}
function CourtFrames(Events, Entry) {
    return Events.filter(
        (E) =>
            E.Frame.length >= 32 &&
            E.Frame.readUInt32BE(24) === Court.CourtClass &&
            E.Frame.readBigUInt64BE(16) === BigInt(Entry.id),
    );
}
function PostGamePosition(Events, Puid) {
    const Hit = Events.find(
        (EventData) =>
            EventData.Frame.length >= 43 &&
            EventData.Frame.readUInt32BE(4) === Position.UpdateListPacket &&
            EventData.Frame.readBigUInt64BE(23) === Puid,
    );
    Assert.ok(Hit, `missing immediate postgame position for ${Puid}`);
    return [Hit.Frame.readInt16BE(36), Hit.Frame.readInt16BE(38), Hit.Frame.readInt16BE(40)];
}

Test('every Boulevard court supplies exact home/away seats, USERDATA and transport before PLAYING', () => {
    for (const Entry of BoulevardCourts) {
        const Events = [],
            S = Setup(Entry, Events),
            Count = S.Players.length;
        try {
            Assert.equal(GotNext.MaybeStartMatch(S.Players[0]), true);
            Assert.equal(CourtFrames(Events.slice(0, Count), Entry).length, Count);
            for (const { Frame: FrameData } of Events.slice(0, Count)) {
                const F = Decode(FrameData);
                Assert.equal(F.get(0).readUInt32LE(), Entry.CourtType);
                Assert.equal(F.get(2).readUInt32LE(), Entry.id);
                Assert.equal(F.has(108), false, 'no Ante-Up bet index in neighborhood');
                Assert.equal(F.get(11)[0], 1);
                Assert.equal(F.get(13).readUInt32LE(), 2);
                Assert.equal(F.get(37)[0], Entry.TeamSize);
                Assert.equal(F.get(15)[0], Entry.TeamSize);
                Assert.notEqual(F.get(12).readBigUInt64LE(), 0n);
                Assert.equal(F.get(101).length, 16);
                Assert.ok(F.get(103).readUInt16LE() > 0);
                S.Players.forEach((P, I) => {
                    const Side = Math.floor(I / Entry.TeamSize),
                        Seat = I % Entry.TeamSize;
                    Assert.equal(F.get((Side ? 17 : 38) + Seat).readBigUInt64LE(), P.Puid);
                    Assert.equal(F.get(59 + Side).readBigUInt64BE(8 + Seat * 8), P.Puid);
                    Assert.deepEqual(
                        Zlib.inflateSync(F.get((Side ? 32 : 53) + Seat).subarray(4)),
                        Userdata.Inflated(P),
                    );
                });
            }
            for (const Recipient of S.Players) {
                const Frames = Events.filter(
                    (E) => E.To === Recipient.Id && E.Frame.readUInt32BE(24) === Player.PlayerClass,
                );
                Assert.equal(Frames.length, Count, 'all four/six PLAYER identities supplied');
                for (const { Frame: FrameData } of Frames) {
                    const B = FrameData.subarray(32),
                        Fields = Body.Decode(B);
                    const Owner = S.Players.find((P) => P.Puid === B.readBigUInt64LE(Fields.Offsets.get(0)));
                    Assert.ok(Owner);
                    Assert.equal(B.readBigUInt64LE(Fields.Offsets.get(1)), Owner.MachineId);
                    Assert.equal(B.readUInt32LE(Fields.Offsets.get(2)), GotNext.State.Playing);
                }
                Assert.equal(GotNext.Warp(Recipient), false, 'PLAYING is not warped back to got-next');
            }
            const Before = Events.length;
            Assert.equal(GotNext.MaybeStartMatch(S.Players[0]), false);
            Assert.equal(Events.length, Before);
            const Initial = Decode(Events[0].Frame);
            for (const Refresh of [Court.BuildParkCourt(Entry), Court.BuildParkCourtOccupancy(Entry)]) {
                const F = Decode(Refresh.Frame);
                Assert.equal(F.has(32) || F.has(53), false, 'do not free profile allocations on refresh');
                for (const Bit of [11, 12, 13, 15, 37, 59, 60, 101, 102, 103, 104])
                    Assert.deepEqual(F.get(Bit), Initial.get(Bit));
            }
            const Physical = Decode(Court.BuildParkCourtMirror(Entry).Frame);
            Assert.equal(Physical.has(101) || Physical.has(53), false, 'physical mirror remains occupancy-only');
        } finally {
            S.Cleanup();
        }
    }
});

Test('neighborhood connection barrier waits for all four/six players and only ACKs duplicates', () => {
    for (const Size of [2, 3]) {
        const Entry = BoulevardCourts.find((C) => C.TeamSize === Size),
            Events = [],
            S = Setup(Entry, Events);
        try {
            Assert.equal(GotNext.MaybeStartMatch(S.Players[0]), true);
            Assert.equal(Court.MarkGameConnected('neighborhood', Entry.name, 999n).Accepted, false);
            for (const [I, P] of S.Players.entries()) {
                Assert.equal(GotNext.HandleGameConnected(P, Command(Entry)), true);
                Assert.equal(P.GotNext.GameConnected, true);
                Assert.equal(
                    Decode(Court.BuildParkCourt(Entry).Frame).get(13).readUInt32LE(),
                    I === S.Players.length - 1 ? 3 : 2,
                );
                const BeforeValue = Events.length;
                GotNext.HandleGameConnected(P, Command(Entry));
                GotNext.Handle(P, Command(Entry, 0x1ef43563));
                Assert.equal(Events.length, BeforeValue + 2, 'duplicate ready/join emit ACKs only');
                Assert.equal(P.PlayerBody.readUInt32LE(P.StateOffset), GotNext.State.Playing);
            }
            const Ready = Decode(Court.BuildParkCourt(Entry).Frame);
            Assert.equal(Ready.has(32) || Ready.has(53), false);
            const Before = Events.length;
            const Other = BoulevardCourts.find((C) => C.id !== Entry.id);
            GotNext.HandleGameConnected(S.Players[0], Command(Other));
            Assert.equal(Events.length, Before, 'wrong court cannot alter or acknowledge game readiness');
        } finally {
            S.Cleanup();
        }
    }
});

Test('every Boulevard team size opens only away during play and promotes the winning side after game end', () => {
    for (const Size of [2, 3]) {
        const Entry = BoulevardCourts.find((C) => C.TeamSize === Size),
            Events = [],
            S = Setup(Entry, Events);
        try {
            Assert.equal(GotNext.MaybeStartMatch(S.Players[0]), true);
            for (const PlayerData of S.Players) GotNext.HandleGameConnected(PlayerData, Command(Entry));
            Assert.deepEqual(
                Slots.SeatsOf(S.Groups[0].SlotObjectId),
                S.Players.slice(0, Size).map((PlayerData) => PlayerData.Puid),
                'home stays occupied during play',
            );
            Assert.deepEqual(
                Slots.SeatsOf(S.Groups[1].SlotObjectId),
                new Array(Size).fill(0n),
                'away is open for the next challengers during play',
            );

            const WinningSide = Size % 2;
            const Reporter = S.Players[WinningSide * Size];
            const Packet = EndCommand(Entry, GotNext.EndResult.Won, 21);
            Assert.equal(GotNext.ReadGameEnd(Packet).Result, GotNext.EndResult.Won);
            const BeforeEnd = Events.length;
            Assert.equal(GotNext.HandleGameEnd(Reporter, Packet), true);
            Assert.equal(Court.GameTeams('neighborhood', Entry.name), null, 'finished generation is removed');
            const Winners = S.Players.slice(WinningSide * Size, WinningSide * Size + Size);
            const Losers = S.Players.filter((PlayerData) => !Winners.includes(PlayerData));
            Assert.deepEqual(
                Slots.SeatsOf(S.Groups[0].SlotObjectId),
                Winners.map((PlayerData) => PlayerData.Puid),
            );
            Assert.deepEqual(Slots.SeatsOf(S.Groups[1].SlotObjectId), new Array(Size).fill(0n));
            for (const PlayerData of Winners) {
                Assert.equal(
                    PlayerData.PlayerBody.readUInt32LE(PlayerData.StateOffset),
                    GotNext.State.GotNext,
                    'winners retain got-next',
                );
                Assert.ok(PlayerData.GotNext, 'winners retain the home court');
                const Destination = Body.Decode(PlayerData.PlayerBody).Offsets.get(147);
                Assert.notEqual(Destination, undefined);
                Assert.ok(
                    Math.abs(PlayerData.PlayerBody.readFloatLE(Destination)) > 1 ||
                        Math.abs(PlayerData.PlayerBody.readFloatLE(Destination + 8)) > 1,
                    'destination is a real court position, not the world origin',
                );
            }
            for (const PlayerData of Losers) {
                Assert.equal(
                    PlayerData.PlayerBody.readUInt32LE(PlayerData.StateOffset),
                    GotNext.State.None,
                    'the loser transition completes only when the server reports WALKING',
                );
                Assert.equal(PlayerData.GotNext, null);
            }
            const Postgame = Events.slice(BeforeEnd);
            const Found = { Raw: S.Raw, Groups: S.Groups };
            Winners.forEach((Winner, Index) => {
                const At = PostGamePosition(Postgame, Winner.Puid);
                Assert.deepEqual(
                    At,
                    GotNext.WinnerPoint(S.Raw, Index).map(Math.round),
                    'winners are pinned in the on-court domino (player 0 on the court centre)',
                );
                if (Index === 0)
                    Assert.deepEqual(
                        At,
                        S.Raw.Pos.map(Math.round),
                        'the first winner is warped to the court marker centre',
                    );
            });
            Losers.forEach((Loser, Index) => {
                const At = PostGamePosition(Postgame, Loser.Puid);
                Assert.deepEqual(
                    At,
                    GotNext.LoserPoint(Found, Index, Losers.length).map(Math.round),
                    'team-game losers are warped to the centred losing zone opposite home',
                );
            });
            const Before = Events.length;
            Assert.equal(GotNext.HandleGameEnd(Reporter, Packet), true, 'duplicate end is acknowledged');
            Assert.equal(Events.length, Before + 1, 'duplicate end emits only its correlated ACK');
        } finally {
            S.Cleanup();
        }
    }
});

Test('waiting challengers survive an away-team promotion and form the next complete roster', () => {
    const Entry = BoulevardCourts.find((C) => C.TeamSize === 2),
        Events = [],
        S = Setup(Entry, Events);
    const Challengers = [];
    try {
        Assert.equal(GotNext.MaybeStartMatch(S.Players[0]), true);
        for (const PlayerData of S.Players) GotNext.HandleGameConnected(PlayerData, Command(Entry));
        for (let Seat = 0; Seat < Entry.TeamSize; Seat++) {
            const Id = NextId++,
                Puid = 0x0110000100000000n + BigInt(Id);
            const PlayerData = {
                Id: Id,
                Puid: Puid,
                State: 2,
                MachineId: BigInt(Id),
                ActivityName: 'neighborhood',
                ActivityKey: 0x3cf672c2,
                Identifier: String(Id),
                PlayerRevision: 1n,
                PlayerBody: Player.StampIdentity(Captured.Body, Captured.PlayerId, Puid).Body,
                GotNext: { Court: S.Groups[1].ObjectId, Slot: 1 },
                Userdata: ProfileFrame(Buffer.alloc(223256, Id & 255)),
                VconlineProfileReady: true,
                Send(FrameData) {
                    Events.push({ To: Id, Frame: FrameData });
                    return true;
                },
                SendObject(FrameData) {
                    Events.push({ To: Id, Frame: FrameData });
                    return true;
                },
            };
            PlayerData.StateOffset = Body.Decode(PlayerData.PlayerBody).Offsets.get(2);
            PlayerData.PlayerBody.writeUInt32LE(GotNext.State.GotNext, PlayerData.StateOffset);
            Assert.ok(Slots.Occupy(S.Groups[1].SlotObjectId, Puid, Entry.TeamSize, Seat));
            Roster.Add(PlayerData);
            Challengers.push(PlayerData);
        }
        const ActiveGeneration = Court.GameTeams('neighborhood', Entry.name);
        Assert.equal(GotNext.Release(Challengers[0]), true);
        Assert.equal(
            Court.GameTeams('neighborhood', Entry.name),
            ActiveGeneration,
            'a waiting challenger leaving cannot tear down the game already in progress',
        );
        Challengers[0].GotNext = { Court: S.Groups[1].ObjectId, Slot: 1 };
        Challengers[0].PlayerBody.writeUInt32LE(GotNext.State.GotNext, Challengers[0].StateOffset);
        Assert.ok(Slots.Occupy(S.Groups[1].SlotObjectId, Challengers[0].Puid, Entry.TeamSize, 0));
        Assert.equal(GotNext.HandleGameEnd(S.Players[2], EndCommand(Entry, GotNext.EndResult.Won)), true);
        Assert.deepEqual(
            Slots.SeatsOf(S.Groups[0].SlotObjectId),
            S.Players.slice(2).map((P) => P.Puid),
        );
        Assert.deepEqual(
            Slots.SeatsOf(S.Groups[1].SlotObjectId),
            Challengers.map((P) => P.Puid),
            'postgame cleanup never erases next-game challengers',
        );
        Assert.equal(GotNext.MaybeStartMatch(S.Players[2]), true, 'winner plus waiting away side starts next game');
        const Next = Court.GameTeams('neighborhood', Entry.name);
        Assert.deepEqual(
            Next.Home,
            S.Players.slice(2).map((P) => P.Puid),
        );
        Assert.deepEqual(
            Next.Away,
            Challengers.map((P) => P.Puid),
        );
    } finally {
        for (const PlayerData of Challengers) {
            Slots.Release(PlayerData.Puid);
            Roster.Remove(PlayerData);
        }
        S.Cleanup();
    }
});

Test('a beaten team can leave the losing zone while winners retain the next game', () => {
    const Entry = BoulevardCourts.find((C) => C.TeamSize === 2),
        Events = [],
        S = Setup(Entry, Events);
    const Challengers = [];
    const AddChallenger = (Seat) => {
        const Id = NextId++,
            Puid = 0x0110000100000000n + BigInt(Id);
        const PlayerData = {
            Id: Id,
            Puid: Puid,
            State: 2,
            MachineId: BigInt(Id),
            ActivityName: 'neighborhood',
            ActivityKey: 0x3cf672c2,
            Identifier: String(Id),
            PlayerRevision: 1n,
            PlayerBody: Player.StampIdentity(Captured.Body, Captured.PlayerId, Puid).Body,
            GotNext: { Court: S.Groups[1].ObjectId, Slot: 1 },
            Userdata: ProfileFrame(Buffer.alloc(223256, Id & 255)),
            VconlineProfileReady: true,
            Send(FrameData) {
                Events.push({ To: Id, Frame: FrameData });
                return true;
            },
            SendObject(FrameData) {
                Events.push({ To: Id, Frame: FrameData });
                return true;
            },
        };
        PlayerData.StateOffset = Body.Decode(PlayerData.PlayerBody).Offsets.get(2);
        PlayerData.PlayerBody.writeUInt32LE(GotNext.State.GotNext, PlayerData.StateOffset);
        Assert.ok(Slots.Occupy(S.Groups[1].SlotObjectId, Puid, Entry.TeamSize, Seat));
        Roster.Add(PlayerData);
        Challengers.push(PlayerData);
        return PlayerData;
    };
    const Walking = (P) => P.PlayerBody.readUInt32LE(P.StateOffset) === GotNext.State.None && !P.GotNext;
    try {
        Assert.equal(GotNext.MaybeStartMatch(S.Players[0]), true);
        for (const P of S.Players) GotNext.HandleGameConnected(P, Command(Entry));
        Assert.equal(GotNext.HandleGameEnd(S.Players[0], EndCommand(Entry, GotNext.EndResult.Won)), true);
        const GameALosers = [S.Players[2], S.Players[3]];
        Assert.ok(GameALosers.every(Walking), 'game A losers are free to leave after the recap');

        AddChallenger(0);
        AddChallenger(1);
        Assert.equal(GotNext.MaybeStartMatch(S.Players[0]), true, 'winners plus challengers start the next game');
        for (const P of [S.Players[0], S.Players[1], ...Challengers]) GotNext.HandleGameConnected(P, Command(Entry));
        Assert.equal(GotNext.HandleGameEnd(S.Players[0], EndCommand(Entry, GotNext.EndResult.Won)), true);

        for (const Loser of GameALosers) {
            Assert.equal(
                Loser.PlayerBody.readUInt32LE(Loser.StateOffset),
                GotNext.State.None,
                'game A losers stay WALKING',
            );
            Assert.equal(Loser.GotNext, null);
        }
        Assert.ok(Challengers.every(Walking), 'game B losers can leave after their recap');
    } finally {
        for (const C of Challengers) {
            Slots.Release(C.Puid);
            Roster.Remove(C);
        }
        S.Cleanup();
    }
});

Test('neighborhood start withholds partial/invalid teams and retries late USERDATA safely', () => {
    for (const Size of [2, 3])
        for (const Mode of [
            'empty-seat',
            'offline',
            'missing-data',
            'short-data',
            'zero-machine',
            'duplicate-machine',
            'send-failure',
            'legacy',
        ]) {
            const Entry = BoulevardCourts.find((C) => C.TeamSize === Size),
                Events = [],
                S = Setup(Entry, Events);
            const OldFormat = process.env.OPAL_PARK_FORMAT;
            try {
                const Peer = S.Players.at(-1),
                    Saved = Peer.Userdata;
                if (Mode === 'empty-seat') Slots.Release(Peer.Puid);
                if (Mode === 'offline') Roster.Remove(Peer);
                if (Mode === 'missing-data') Peer.Userdata = null;
                if (Mode === 'short-data') Peer.Userdata = ProfileFrame(Buffer.alloc(100));
                if (Mode === 'zero-machine') Peer.MachineId = 0n;
                if (Mode === 'duplicate-machine') Peer.MachineId = S.Players[0].MachineId;
                if (Mode === 'send-failure') Peer.SendObject = () => false;
                if (Mode === 'legacy') process.env.OPAL_PARK_FORMAT = 'legacy';
                Assert.equal(GotNext.MaybeStartMatch(S.Players[0]), false, Mode);
                Assert.ok(S.Players.every((P) => !P.GotNext.Playing));
                Assert.equal(Decode(Court.BuildParkCourt(Entry).Frame).get(13).readUInt32LE(), 0);
                if (Mode === 'missing-data') {
                    Userdata.Relay(Peer, Saved);
                    Assert.ok(S.Players.every((P) => P.GotNext.Playing));
                    const Before = Events.length;
                    Userdata.Relay(Peer, Saved);
                    Assert.equal(Events.length, Before, 'profile update cannot repeat game initialization');
                }
            } finally {
                if (OldFormat === undefined) delete process.env.OPAL_PARK_FORMAT;
                else process.env.OPAL_PARK_FORMAT = OldFormat;
                S.Cleanup();
            }
        }
});

Test('simultaneous neighborhood games isolate rosters/traffic and preserve public observers', () => {
    const Events = [],
        Entries = [BoulevardCourts.find((C) => C.TeamSize === 2), BoulevardCourts.find((C) => C.TeamSize === 3)];
    const Games = Entries.map((E) => Setup(E, Events)),
        Observers = [];
    try {
        for (let I = 0; I < 120; I++) {
            const P = {
                Id: NextId++,
                Puid: BigInt(NextId),
                State: 2,
                ActivityName: I < 100 ? 'neighborhood' : 'stage',
                ActivityKey: I < 100 ? 0x3cf672c2 : 0xdb0b03f5,
                SendObject(FrameData) {
                    Events.push({ To: this.Id, Frame: FrameData });
                    return true;
                },
            };
            Observers.push(P);
            Roster.Add(P);
        }
        Games.forEach((S) => Assert.equal(GotNext.MaybeStartMatch(S.Players[0]), true));
        const Tokens = Entries.map((E) => Decode(Court.BuildParkCourt(E).Frame).get(101));
        Assert.ok(!Tokens[0].equals(Tokens[1]));
        Assert.equal(
            Events.some((E) => E.Frame.readUInt32BE(4) === 0x9d32c5b4),
            false,
            'no WORLD roster replacement',
        );
        Assert.ok(
            Events.every((E) => !Observers.slice(100).some((P) => P.Id === E.To)),
            'no cross-activity broadcast',
        );
        for (const S of Games) {
            Events.length = 0;
            const Raw = Buffer.from('neighborhood-game-command');
            const FrameData = Frame.Build(
                0x9e3471ed,
                Buffer.alloc(8),
                new FieldList.Builder()
                    .AddBlob(Userdata.GamePayloadField, Raw)
                    .AddU32('COMMAND', Userdata.ReplayCommand)
                    .Build(),
                Frame.InnerHeader.Object,
            );
            Assert.equal(Userdata.Relay(S.Players[0], FrameData), S.Players.length - 1);
            Assert.deepEqual(
                Events.map((E) => E.To).sort(),
                S.Players.slice(1)
                    .map((P) => P.Id)
                    .sort(),
            );
            for (const { Frame: Delivery } of Events) {
                const Fields = FieldList.Parse(Delivery, Frame.HeaderSize + 12);
                Assert.deepEqual(
                    Zlib.inflateSync(FieldList.ReadBlob(Fields, FieldList.Find(Fields, Userdata.CompressedDataField))),
                    Raw,
                );
            }
        }
        GotNext.Release(Games[0].Players[0]);
        Assert.equal(Decode(Court.BuildParkCourt(Entries[0]).Frame).get(13).readUInt32LE(), 0);
        Assert.deepEqual(
            Decode(Court.BuildParkCourt(Entries[1]).Frame).get(101),
            Tokens[1],
            'other game survives leave',
        );
        GotNext.Vacate(Games[1].Players[0]);
        Assert.equal(Decode(Court.BuildParkCourt(Entries[1]).Frame).get(13).readUInt32LE(), 0);
        const Ids = Games[0].Players.map((P) => P.Puid),
            Size = Entries[0].TeamSize;
        const Profiles = Games[0].Players.map((P) => Userdata.Read(P.Userdata).Blob);
        const Replacement = Court.PrepareGameTeams(
            'neighborhood',
            Entries[0].name,
            Ids.slice(0, Size),
            Ids.slice(Size),
            { Home: Profiles.slice(0, Size), Away: Profiles.slice(Size) },
        );
        Assert.ok(!Decode(Replacement.Frame).get(101).equals(Tokens[0]), 'new generation rotates transport token');
    } finally {
        Games.forEach((S) => S.Cleanup());
        Observers.forEach((P) => Roster.Remove(P));
    }
});
