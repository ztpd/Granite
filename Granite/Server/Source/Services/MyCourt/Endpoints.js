// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { BuildIdaStub } = require('../IdaSpecificStub');

const Endpoints = Object.freeze({
    Create: Object.freeze({
        Id: 0x9595a6a2,
        Route: 'mycourt/create',
        Url: 'https://nba2k19-svc.2ksports.com:21138/nba/2k19/mmg/mycourt/create',
        Evidence: '2K19_LOGIN_TABLE_PROVISIONAL',
    }),
    State: Object.freeze({
        Id: 0x7dde97d0,
        Route: 'mycourt/state',
        Url: 'https://nba2k19-svc.2ksports.com:21138/nba/2k19/mmg/mycourt/state',
        Evidence: '2K19_LOGIN_TABLE_PROVISIONAL',
    }),
    InterLockedUpdate: Object.freeze({
        Id: 0x22af8cca,
        Route: 'mycourt/interlockedupdate',
        Url: 'https://nba2k19-svc.2ksports.com:21138/nba/2k19/mmg/mycourt/InterLockedUpdate',
        Evidence: '2K19_LOGIN_TABLE_PROVISIONAL',
    }),
    Leave: Object.freeze({
        Id: 0x0222a4e4,
        Route: 'mycourt/leave',
        Url: 'https://nba2k19-svc.2ksports.com:21138/nba/2k19/mmg/mycourt/leave',
        Evidence: '2K19_LOGIN_TABLE_PROVISIONAL',
    }),
    PrivateQuery: Object.freeze({
        Id: 0x7fa6c24f,
        Route: 'mycourt/privatequery',
        Url: 'https://nba2k19-svc.2ksports.com:21138/nba/2k19/mmg/mycourt/PrivateQuery',
        Evidence: '2K19_LOGIN_TABLE_PROVISIONAL',
    }),
    Query: Object.freeze({
        Id: 0xbd2f91df,
        Route: 'mycourt/query',
        Url: 'https://nba2k19-svc.2ksports.com:21138/nba/2k19/mmg/mycourt/query',
        Evidence: '2K19_LOGIN_TABLE_PROVISIONAL',
    }),
    Remove: Object.freeze({
        Id: 0x72c35b69,
        Route: 'mycourt/remove',
        Url: 'https://nba2k19-svc.2ksports.com:21138/nba/2k19/mmg/mycourt/remove',
        Evidence: '2K19_LOGIN_TABLE_PROVISIONAL',
    }),
    Search: Object.freeze({
        Id: 0xaeb39dfe,
        Route: 'mycourt/search',
        Url: 'https://nba2k19-svc.2ksports.com:21138/nba/2k19/mmg/mycourt/search',
        Evidence: '2K19_LOGIN_TABLE_PROVISIONAL',
    }),
    Update: Object.freeze({
        Id: 0x82667321,
        Route: 'mycourt/update',
        Url: 'https://nba2k19-svc.2ksports.com:21138/nba/2k19/mmg/mycourt/update',
        Evidence: '2K19_LOGIN_TABLE_PROVISIONAL',
    }),
});

const AllEndpointIds = Object.freeze(Object.values(Endpoints).map((Endpoint) => Endpoint.Id));
const ByRoute = new Map(Object.values(Endpoints).map((Endpoint) => [Endpoint.Route, Endpoint]));
const ById = new Map(Object.values(Endpoints).map((Endpoint) => [Endpoint.Id >>> 0, Endpoint]));

function Resolve(RouteOrId) {
    if (typeof RouteOrId === 'string') {
        const Route = RouteOrId.toLowerCase().replace(/^\/+|\/+$/g, '');
        return ByRoute.get(Route) || null;
    }
    return ById.get(Number(RouteOrId) >>> 0) || null;
}

function Build(Input, Context = {}) {
    const Endpoint = Resolve(Context.Route) || Endpoints.Query;
    return BuildIdaStub(Input, Context, Endpoint.Id, `NBA2K19 MyCourt ${Endpoint.Route}`);
}

module.exports = {
    Build,
    MyCourt: Build,
    Endpoints,
    AllEndpointIds,
    ByRoute,
    ById,
    Resolve,
    EndpointIds: Object.freeze([]),
    ExactEndpointIds: Object.freeze([]),
    UnobservedEndpointIds: AllEndpointIds,
    Feature: 'TK_WORLD::ACTIVITY_MYCOURT / MMG_MYCOURT',
    Status: '2K19_LOGIN_TABLE_PRESENT_RESPONSE_SCHEMA_PROVISIONAL',
};
