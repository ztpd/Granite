// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { BuildIdaStub, Status } = require('../IdaSpecificStub');

const EndpointIds = Object.freeze([
    0x23e8e88c, 0x2ec683f8, 0x390ac39f, 0x5337d309, 0x56489dce, 0x5a0b138b, 0x60c25e37, 0x92bd1d99, 0x95c85943,
    0x9a08cf34, 0x9c4d6b10, 0xb460ce57, 0xbf0a9405, 0xbf41429e,
]);

function Build(Input, Context) {
    return BuildIdaStub(Input, Context, EndpointIds, 'Unresolved NBA2K19 static service IDs');
}

module.exports = { Build, Unresolved: Build, EndpointIds, Status };
