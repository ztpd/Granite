// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const JsonBlob = require('../JsonBlob');
const Logger = require('../../../Core/Logger');

const Crcs = JsonBlob.Crcs;

const EndpointIds = Object.freeze({
    GetDefaultCollection: 0x5251bc93,
    UserCollectionShort: 0xa75cfbee,
});

const JsonKeys = Object.freeze({
    SkippedRootMember: JsonBlob.SkippedRootMember,
    DefaultCollectionExtra: 0xec53421d,
});

const CardListMember = 'collection';

const Documents = Object.freeze({
    DefaultCollection: Object.freeze({ [CardListMember]: [] }),
    UserCollectionShort: Object.freeze({}),
});

function GetDefaultCollection() {
    Logger.Verbose('MyTeam2k19/get_default_collection: no card catalog; answering an empty default collection');
    return JsonBlob.Reply(Documents.DefaultCollection);
}

function UserCollectionShort() {
    Logger.Verbose('MyTeam2k19/user_collection_short: answering an empty user collection');
    return JsonBlob.Reply(Documents.UserCollectionShort);
}

const Routes = Object.freeze({
    'myteam2k19/get_default_collection': GetDefaultCollection,
    'myteam2k19/user_collection_short': UserCollectionShort,
});

function Resolve(Route) {
    return Object.prototype.hasOwnProperty.call(Routes, Route);
}

function Build(Input, Context = {}) {
    const Handler = Routes[Context.Route];
    if (!Handler) throw new Error(`MyTeam item cache has no route ${Context.Route}`);
    return Handler(Input, Context);
}

module.exports = {
    Build,
    Resolve,
    GetDefaultCollection,
    UserCollectionShort,
    EncodeJsonBlob: JsonBlob.Encode,
    Crcs,
    EndpointIds,
    JsonKeys,
    CardListMember,
    Documents,
    Status: 'IDA_TRACED_EMPTY_COLLECTION',
};
