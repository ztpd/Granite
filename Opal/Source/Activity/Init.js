// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Zlib = require('zlib');
const FieldList = require('../Codec/FieldList');
const Frame = require('../Codec/Frame');

const ConnectPacketId = 0x9d32c5b4;

const Success = 0x504521a8;

function PackEndpoint(Ip, Port) {
    const Octets = String(Ip).split('.').map(Number);
    if (Octets.length !== 4 || Octets.some((O) => !Number.isInteger(O) || O < 0 || O > 255)) {
        throw new Error(`relay address ${Ip} is not an IPv4 address`);
    }
    return {
        Address: ((Octets[0] << 24) | (Octets[1] << 16) | (Octets[2] << 8) | Octets[3]) >>> 0,
        Port: (Port << 16) >>> 0,
    };
}

const RetiredRelay = { Ip: '44.234.178.122', Port: 31001 };

const Variant = {
    Standard: {
        Unknown2A6ACAAD: [0x1a236ec5, 0x76020000],
        Unknown87E5BC62: [0x1a236ec5, 0x7d020047],
        Unknown9049A1DB: [0xfc5f3c56, 0x83020047],
        ResultExtra: 0x96020047,
        Data: Buffer.from('8003000000000000d0ba44a776020000', 'hex'),
        AccountId: 0x011000013f9e0fb3n,
        MachineId: 0x00000000000068fan,
    },
    MyCourt: {
        Unknown2A6ACAAD: [0x1a236ec5, 0x00000000],
        Unknown87E5BC62: [0x1a236ec5, 0x5e8b0dd2],
        Unknown9049A1DB: [0x01460b9e, 0x00000000],
        ResultExtra: 0x00000000,
        Data: Buffer.from('00000000000000008624ae62f77f0000', 'hex'),
        AccountId: 0x190008005c85f005n,
        MachineId: 0x190008005c85f005n,
    },
};

const UserDataField = {
    PrimaryUserId: 0x2d50927f,
    AvatarId: 0xc1b93b79,
    Gamertag: 0x8cb84fe9,
    SecondaryId: 0xd3ef76a9,
    HasUserdataA: 0x8cbf31a5,
    HasUserdataB: 0x5ebad932,
    Always1: 0x9a913400,
    ZeroA: 0xfab7631f,
    ZeroB: 0x2834e7b8,
    ZeroC: 0x2c55fadf,
    Userdata: 0xcdbd175e,
};

const MachineDataList = 0x3fa02989;
const UserTeamIdList = 0x61e5e2ac;

function BuildSportsUserFields({ AccountId, Gamertag, Userdata }) {
    const Has = Boolean(Userdata && Userdata.length);
    const Account = BigInt.asUintN(64, BigInt(AccountId));
    const Inner = new FieldList.Builder();
    Inner.AddU64(UserDataField.PrimaryUserId, Account);
    Inner.AddU64(UserDataField.AvatarId, 0n);
    Inner.AddString(UserDataField.Gamertag, Gamertag || '');
    Inner.AddU64(UserDataField.SecondaryId, 0n);
    Inner.AddBool(UserDataField.HasUserdataA, Has);
    Inner.AddBool(UserDataField.HasUserdataB, Has);
    Inner.AddBool(UserDataField.Always1, true);
    Inner.AddU64(UserDataField.ZeroA, 0n);
    Inner.AddU64(UserDataField.ZeroB, 0n);
    Inner.AddU64(UserDataField.ZeroC, 0n);
    if (!Has) Inner.AddBlob(0x5c3216a2, Buffer.alloc(0));
    Inner.AddBlob(UserDataField.Userdata, Has ? Userdata : Buffer.alloc(0));
    return Inner.Build();
}

function BuildUserDataEntry(Player) {
    return Zlib.deflateSync(BuildSportsUserFields(Player), { level: 9 });
}

function BuildMachineDataEntry() {
    return new FieldList.Builder().AddU64(0x6875d146, 0n).Build();
}

function Build({
    SessionId,
    SessionVerify,
    Players = null,
    IncludeMatchType = true,
    Variant: VariantValue = Variant.Standard,
    Relay = RetiredRelay,
    RelayId = 0x0an,
    SelfMachineId = null,
    RelayToken = null,
} = {}) {
    const Roster =
        Array.isArray(Players) && Players.length
            ? Players
            : [{ AccountId: VariantValue.AccountId, MachineId: VariantValue.MachineId }];
    const Self = SelfMachineId !== null ? SelfMachineId : Roster[0].MachineId;
    const Endpoint = PackEndpoint(Relay.Ip, Relay.Port);

    const List = new FieldList.Builder();

    const Data =
        RelayToken && RelayToken.length === VariantValue.Data.length ? Buffer.from(RelayToken) : VariantValue.Data;
    List.AppendData(Data);

    List.AddU64('MATCH_VERSION', SessionVerify);
    List.AddBlobRef(0x247fa77f, 0, 0);
    if (IncludeMatchType) List.AddU64('MATCH_TYPE', SessionId);
    List.AddU32(0x2a6acaad, VariantValue.Unknown2A6ACAAD[0], VariantValue.Unknown2A6ACAAD[1]);
    for (const Player of Roster) List.AddU64('USER_ID_LIST', Player.AccountId);
    for (const Player of Roster) List.AddU64(UserTeamIdList, Player.TeamId || 0n);
    List.AddPacked(0x6cd5d4f9, Endpoint.Address, Endpoint.Port);
    List.AddU32(0x87e5bc62, VariantValue.Unknown87E5BC62[0], VariantValue.Unknown87E5BC62[1]);
    for (const _ of Roster) List.AddU64(0x8c9ef2cf, 1n);
    List.AddU32(0x9049a1db, VariantValue.Unknown9049A1DB[0], VariantValue.Unknown9049A1DB[1]);
    for (const Player of Roster) List.AddU64(0x92cd7d5b, Player.MachineId);
    for (const Player of Roster) List.AddBlob(0x9ad3e8f7, BuildUserDataEntry(Player));
    for (const _ of Roster) List.AddBlob(MachineDataList, BuildMachineDataEntry());

    List.AddU64(0xa2026379, RelayId);
    List.AddBlobRef(0xae6eea84, 0, Data.length);
    List.AddU64(0xc56500f9, Self);
    List.AddU64('MATCH_ID', SessionId);
    List.AddU32('RESULT', Success, VariantValue.ResultExtra);

    return Frame.Build(ConnectPacketId, null, List.Build(), Frame.InnerHeader.None);
}

module.exports = {
    Build,
    ConnectPacketId,
    Success,
    Variant,
    PackEndpoint,
    RetiredRelay,
    BuildSportsUserFields,
    BuildUserDataEntry,
    BuildMachineDataEntry,
    UserDataField,
    MachineDataList,
    UserTeamIdList,
};
