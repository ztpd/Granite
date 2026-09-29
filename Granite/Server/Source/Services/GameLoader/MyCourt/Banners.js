// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Inventory = require('../../Inventory/GetWithTag');

const EndpointIds = Object.freeze([0xf23e8b39]);
function Build(Input, Context) {
    return Inventory.Build(Input, Context);
}

module.exports = {
    Build,
    Banners: Build,
    EndpointIds,
    Feature: 'GAMELOADER_ITEM_MYCOURT_BANNERS/ONLINESTORE_CHECKINVENTORY_JOB',
    Status: Inventory.Status,
};
