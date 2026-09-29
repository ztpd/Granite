// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { Builder } = require('../Codec/FieldList');
const { Crc32 } = require('../Core/Crc32');
const Logger = require('../Core/Logger');

const Result = Crc32('RESULT');
const Success = Crc32('SUCCESS');

function BuildIdaStub(Input, Context = {}, EndpointIds = [], Label = 'NBA2K19 IDA endpoint') {
    const Ids = Array.isArray(EndpointIds) ? EndpointIds : [EndpointIds];
    const IdText = Ids.map((Id) => `0x${(Number(Id) >>> 0).toString(16).toUpperCase().padStart(8, '0')}`).join(', ');
    Logger.Verbose(
        `${Label}: static NBA2K19 IDA service id ${IdText}; route/transport/response schema pending capture`,
    );
    return new Builder().AddU32(Result, Success).Build();
}

module.exports = {
    BuildIdaStub,
    Result,
    Success,
    Status: 'IDA_EXACT_2K19_STATIC_LOOKUP_ROUTE_UNKNOWN',
};
