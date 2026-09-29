// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Assert = require('assert');
const Zlib = require('zlib');
const Init = require('../Source/Activity/Init');
const Activities = require('../Source/Activity/Activities');
const Frame = require('../Source/Codec/Frame');
const FieldList = require('../Source/Codec/FieldList');
const { Crc } = require('../Source/Core/Names');

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

const Golden = {
    neighborhood:
        '200100009d32c5b400000000000000001780ec1f3d9e508900000000000003e9247fa77f36182e8300000000000000002a6acaad1423add21a236ec5760200003a60fe523d9e5089011000013f9e0fb36cd5d4f9320b919b2ceab27a7919000087e5bc621423add21a236ec57d0200478c9ef2cf3d9e508900000000000000019049a1db1423add2fc5f3c568302004792cd7d5b3d9e508900000000000068fa9ad3e8f736182e830000000000000000a20263793d9e5089000000000000000aae6eea8436182e830000000000000010c56500f93d9e508900000000000068fad4c0767a3d9e508900000000000003e8e39206951423add2504521a896020047000000000000000000000000000000008003000000000000d0ba44a776020000',
    stage: '300100009d32c5b400000000000000001780ec1f3d9e508900000000000003eb247fa77f36182e83000000000000000027efd4603d9e508900000000000003ea2a6acaad1423add21a236ec5760200003a60fe523d9e5089011000013f9e0fb36cd5d4f9320b919b2ceab27a7919000087e5bc621423add21a236ec57d0200478c9ef2cf3d9e508900000000000000019049a1db1423add2fc5f3c568302004792cd7d5b3d9e508900000000000068fa9ad3e8f736182e830000000000000000a20263793d9e5089000000000000000aae6eea8436182e830000000000000010c56500f93d9e508900000000000068fad4c0767a3d9e508900000000000003eae39206951423add2504521a896020047000000000000000000000000000000008003000000000000d0ba44a776020000',
    cages: '300100009d32c5b400000000000000001780ec1f3d9e508900000000000003ed247fa77f36182e83000000000000000027efd4603d9e508900000000000003ec2a6acaad1423add21a236ec5760200003a60fe523d9e5089011000013f9e0fb36cd5d4f9320b919b2ceab27a7919000087e5bc621423add21a236ec57d0200478c9ef2cf3d9e508900000000000000019049a1db1423add2fc5f3c568302004792cd7d5b3d9e508900000000000068fa9ad3e8f736182e830000000000000000a20263793d9e5089000000000000000aae6eea8436182e830000000000000010c56500f93d9e508900000000000068fad4c0767a3d9e508900000000000003ece39206951423add2504521a896020047000000000000000000000000000000008003000000000000d0ba44a776020000',
};

void Golden;

const ParallelLists = {
    UserId: Crc('USER_ID_LIST'),
    UserTeamId: Init.UserTeamIdList,
    MachineId: 0x92cd7d5b,
    UserCountPerMachine: 0x8c9ef2cf,
    UserData: 0x9ad3e8f7,
    MachineData: Init.MachineDataList,
};

for (const Name of ['neighborhood', 'stage', 'cages']) {
    Test(`the ${Name} init reply carries the IDA-required session structure`, () => {
        const Activity = Activities.Activities.find((A) => A.Name === Name);
        Assert.ok(Activity, `${Name} is registered`);
        const Built = Activities.BuildInit(Activity);

        const FrameData = Frame.Parse(Built);
        Assert.strictEqual(FrameData.PacketId, Init.ConnectPacketId, 'a Connect frame');
        Assert.ok(Frame.IsWellFormed(FrameData), 'well formed');

        const List = FieldList.Parse(Built, Frame.HeaderSize);
        const Count = (CrcValue) => List.Fields.filter((F) => F.Crc === CrcValue >>> 0).length;

        Assert.strictEqual(FieldList.Find(List, 'RESULT').Data1 >>> 0, Init.Success);
        Assert.strictEqual(FieldList.Find(List, 'MATCH_ID').Value, Activity.SessionId);
        Assert.ok(FieldList.Find(List, 0xc56500f9), 'self MACHINE_ID is present');

        const Users = Count(ParallelLists.UserId);
        Assert.ok(Users >= 1, 'at least one user');
        Assert.strictEqual(Count(ParallelLists.UserTeamId), Users, 'USER_TEAM_ID matches USER_ID_LIST');
        Assert.strictEqual(Count(ParallelLists.MachineId), Users, 'one machine id per user');
        Assert.strictEqual(Count(ParallelLists.UserCountPerMachine), Users, 'one per-machine count per user');
        Assert.strictEqual(Count(ParallelLists.UserData), Users, 'one user-data element per user');
        Assert.strictEqual(Count(ParallelLists.MachineData), Users, 'one machine-data element per user');
    });
}

Test('mycourt differs from the others only in its variant and relay', () => {
    const Activity = Activities.Activities.find((A) => A.Name === 'mycourt');
    Assert.strictEqual(Activity.Variant, Init.Variant.MyCourt);
    Assert.strictEqual(
        Activity.Relay,
        Activities.Relay.Local,
        'a dead relay here produces "mycourt is no longer available" after the world loads',
    );
    const Built = Activities.BuildInit(Activity);
    Assert.ok(Frame.IsWellFormed(Frame.Parse(Built)));
});

Test('every reply is a well formed connect frame carrying success', () => {
    for (const Activity of Activities.Activities) {
        const Built = Activities.BuildInit(Activity);
        const FrameData = Frame.Parse(Built);
        Assert.strictEqual(FrameData.PacketId, Init.ConnectPacketId, Activity.Name);
        Assert.ok(Frame.IsWellFormed(FrameData), Activity.Name);

        const List = FieldList.Parse(Built, Frame.HeaderSize);
        Assert.strictEqual(FieldList.Find(List, 'RESULT').Data1 >>> 0, Init.Success, Activity.Name);
        Assert.strictEqual(FieldList.Find(List, 'MATCH_ID').Value, Activity.SessionId, Activity.Name);
        Assert.strictEqual(
            FieldList.Find(List, 'MATCH_VERSION').Value,
            Activity.SessionId + 1n,
            'verify is always the session id plus one',
        );
    }
});

Test('only the neighborhood omits MatchType', () => {
    for (const Activity of Activities.Activities) {
        const List = FieldList.Parse(Activities.BuildInit(Activity), Frame.HeaderSize);
        const Present = !!FieldList.Find(List, 'MATCH_TYPE');
        Assert.strictEqual(Present, Activity.Name !== 'neighborhood', Activity.Name);
    }
});

Test('the relay endpoint packs as an address and a shifted port', () => {
    const Packed = Init.PackEndpoint('44.234.178.122', 31001);
    Assert.strictEqual(Packed.Address >>> 0, 0x2ceab27a);
    Assert.strictEqual(Packed.Port >>> 0, 0x79190000);

    const Local = Init.PackEndpoint('127.0.0.1', 28091);
    Assert.strictEqual(Local.Address >>> 0, 0x7f000001);
    Assert.strictEqual(Local.Port >>> 0, 0x6dbb0000);

    Assert.throws(() => Init.PackEndpoint('not an address', 1), /IPv4/);
});

Test('activities resolve by activity key, and mycourt by world key', () => {
    Assert.strictEqual(Activities.Lookup(0x3cf672c2, null).Name, 'neighborhood');
    Assert.strictEqual(Activities.Lookup(0xdb0b03f5, null).Name, 'stage');
    Assert.strictEqual(Activities.Lookup(0xfc9797cf, null).Name, 'cages');
    Assert.strictEqual(Activities.Lookup(null, Crc('CRIB')).Name, 'mycourt');
    Assert.strictEqual(Activities.Lookup(0xdeadbeef, 0xdeadbeef), null);
});

Test('a second player adds one entry to each repeated field', () => {
    const Activity = Activities.Activities.find((A) => A.Name === 'cages');
    const Two = Activities.BuildInit(Activity, [
        { AccountId: 0x011000013f9e0fb3n, MachineId: 0x68fan },
        { AccountId: 0x0110000103b57f79n, MachineId: 0x68fbn },
    ]);
    const List = FieldList.Parse(Two, Frame.HeaderSize);
    const Count = (CrcValue) => List.Fields.filter((F) => F.Crc === CrcValue >>> 0).length;
    Assert.strictEqual(Count(Crc('USER_ID_LIST')), 2);
    Assert.strictEqual(Count(Init.UserTeamIdList), 2, 'USER_TEAM_ID per player, matching USER_ID_LIST');
    Assert.strictEqual(Count(0x92cd7d5b), 2, 'machine id per player');
    Assert.strictEqual(Count(0x8c9ef2cf), 2);
    Assert.strictEqual(Count(0x9ad3e8f7), 2);
    Assert.strictEqual(Count(Init.MachineDataList), 2);
    Assert.strictEqual(Count(Crc('MATCH_ID')), 1, 'session fields stay single');
});

Test('a 128-player public roster preserves every parallel VCONLINE cardinality', () => {
    const Activity = Activities.Activities.find((A) => A.Name === 'neighborhood');
    const Players = Array.from({ length: 128 }, (_, I) => ({
        AccountId: 0x0110000100010000n + BigInt(I),
        MachineId: 0x7000n + BigInt(I),
        TeamId: 0n,
        Gamertag: `player${I}`,
    }));
    const Outer = FieldList.Parse(Activities.BuildInit(Activity, Players), Frame.HeaderSize);
    const Count = (CrcValue) => Outer.Fields.filter((F) => F.Crc === CrcValue >>> 0).length;
    for (const CrcValue of Object.values(ParallelLists)) Assert.strictEqual(Count(CrcValue), 128);

    const MachineFields = Outer.Fields.filter((F) => F.Crc === Init.MachineDataList);
    for (const Field of MachineFields) {
        const Inner = FieldList.Parse(FieldList.ReadBlob(Outer, Field), 0);
        Assert.strictEqual(FieldList.Find(Inner, 0x6875d146).Value, 0n);
    }
});

Test('VCONLINE user data is compressed and machine data is a raw 2K19 field list', () => {
    const Activity = Activities.Activities.find((A) => A.Name === 'neighborhood');
    const Account = 0x01100001349dd023n;
    const Reply = Activities.BuildInit(Activity, [
        {
            AccountId: Account,
            MachineId: 0x68fan,
            TeamId: 0n,
            Gamertag: 'frag',
            Userdata: Buffer.alloc(223256, 0x2a),
        },
    ]);
    const Outer = FieldList.Parse(Reply, Frame.HeaderSize);
    const UserField = FieldList.Find(Outer, ParallelLists.UserData);
    const MachineField = FieldList.Find(Outer, ParallelLists.MachineData);
    const UserBytes = FieldList.ReadBlob(Outer, UserField);
    const MachineBytes = FieldList.ReadBlob(Outer, MachineField);
    const Inflated = Zlib.inflateSync(UserBytes);
    const Inner = FieldList.Parse(Inflated, 0);
    Assert.strictEqual(FieldList.Find(Inner, Init.UserDataField.PrimaryUserId).Value, Account);
    Assert.strictEqual(FieldList.ReadString(Inner, FieldList.Find(Inner, Init.UserDataField.Gamertag)), 'frag');
    Assert.strictEqual(FieldList.ReadBlob(Inner, FieldList.Find(Inner, Init.UserDataField.Userdata)).length, 223256);

    Assert.throws(() => Zlib.inflateSync(MachineBytes), /incorrect header|unknown compression|invalid/i);
    const Machine = FieldList.Parse(MachineBytes, 0);
    Assert.strictEqual(Machine.Fields.length, 1);
    Assert.strictEqual(FieldList.Find(Machine, 0x6875d146).Value, 0n);
});

process.stdout.write(`\n${Passed} passing\n`);
