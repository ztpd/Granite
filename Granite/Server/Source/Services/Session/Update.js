// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { Builder, GetU32, GetU64, DateToVCDate } = require('../../Codec/FieldList');
const Login = require('./Login');

function SafeBigInt(Value) {
    try {
        return Value === null || Value === undefined || Value === '' ? null : BigInt(Value);
    } catch {
        return null;
    }
}

function Build(Input, Context = {}) {
    const Fields = Input?.Parsed?.Fields || [];
    const Key = GetU64(Fields, Login.Crcs.SessionKey) ?? SafeBigInt(Context.SessionKey);
    const Current = Key === null ? null : Context.Sessions.get(Key);
    const Now = DateToVCDate();
    const Reply = new Builder()
        .AddVCDate(Login.Crcs.IssuedAt, Now)
        .AddVCDate(Login.Crcs.ServerTime, Now)
        .AddU32(Login.Crcs.Result, Login.Crcs.Success);
    if (Current) Reply.AddU64(Login.Crcs.SessionKey, Current.key);
    const Environment = GetU32(Fields, Login.Crcs.Environment);
    if (Environment !== null) Reply.AddU32(Login.Crcs.Environment, Environment);
    return Reply.Build();
}

module.exports = { Build, Update: Build, Status: 'CROSS_VERSION_VERIFIED_SHAPE' };
