// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { BuildIdaStub, Status } = require('../IdaSpecificStub');

const EndpointIds = Object.freeze([0x26848f5b]);
function Build(Input, Context) {
    return BuildIdaStub(Input, Context, EndpointIds, 'Blacktop play with friends');
}

module.exports = { Build, PlayWithFriends: Build, EndpointIds, Feature: 'blacktopplaywithfriends.vcc', Status };
