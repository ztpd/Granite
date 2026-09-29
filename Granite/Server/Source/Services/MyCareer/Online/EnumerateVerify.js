// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { BuildIdaStub, Status } = require('../../IdaSpecificStub');

const EndpointIds = Object.freeze([0xba5ebe12]);
function Build(Input, Context) {
    return BuildIdaStub(Input, Context, EndpointIds, 'MyCareer online remote enumerate/verify');
}

module.exports = {
    Build,
    EnumerateVerify: Build,
    EndpointIds,
    Feature: 'MYCAREER_ONLINE_REMOTE_ENUMERATE_REQUEST/MYCAREER_ONLINE_REMOTE_VERIFY_REQUEST',
    Status,
};
