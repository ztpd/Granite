// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { BuildIdaStub, Status } = require('../../IdaSpecificStub');

const EndpointIds = Object.freeze([0x9516d8ab]);
function Build(Input, Context) {
    return BuildIdaStub(Input, Context, EndpointIds, 'MyCareer online remote download');
}

module.exports = { Build, Download: Build, EndpointIds, Feature: 'MYCAREER_ONLINE_REMOTE_DOWNLOAD_REQUEST', Status };
