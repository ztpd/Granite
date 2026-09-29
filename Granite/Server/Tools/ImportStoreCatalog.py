# Copyright (c) 2026 Celestial
# Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

import hashlib
import io
import json
from pathlib import Path
import re
import struct
import sys
import zipfile


def ReadManifest(File):
    Root = File.parent.resolve()
    Assets, Bases = {}, {}
    Total = 0
    for Line in File.read_text(encoding='utf-8-sig').splitlines():
        Match = re.fullmatch(r'(\S+)\s+(\S+)\s+(\d+)\s+(\d+)\s*', Line)
        if not Match:
            continue
        Archive, Name, Offset, Size = Match.groups()
        if not re.fullmatch(r'[0-9A-Z]{2}', Archive):
            raise ValueError(f'invalid archive name: {Archive}')
        if Archive not in Bases:
            Bases[Archive] = Total
            Total += (Root / Archive).stat().st_size
        Assets[Name] = (Root / Archive, int(Offset) - Bases[Archive], int(Size))
    return Assets


def ReadAsset(Assets, Name):
    File, Offset, Size = Assets[Name]
    if Offset < 0 or Size > 64 * 1024 * 1024 or Offset + Size > File.stat().st_size:
        raise ValueError(f'invalid manifest bounds for {Name}')
    with File.open('rb') as Stream:
        Stream.seek(Offset)
        return Stream.read(Size)


def CString(Data, Offset):
    if not 0 <= Offset < len(Data):
        raise ValueError('string offset outside catalog pool')
    End = Data.find(b'\0', Offset)
    if End < 0:
        raise ValueError('unterminated catalog string')
    return Data[Offset:End].decode('utf-8')


def DecodeCatalog(Files, ManifestNames):
    Count, = struct.unpack('<I', Files['store_num_items_data.BIN'])
    Data = Files['store_items_data.BIN']
    Names = Files['store_items_name_string_buffer_data.BIN']
    Offsets = Files['store_items_name_string_array_data.BIN']
    Pool = Files['store_items_content_guid_pool.BIN']
    if not 1 <= Count <= 100000 or len(Data) != Count * 0x208 or len(Offsets) != Count * 8:
        raise ValueError('unsupported NBA2K19 store table dimensions')
    Items = {}
    Matched = set()
    for Index in range(Count):
        Record = Data[Index * 0x208:(Index + 1) * 0x208]
        Item, = struct.unpack_from('<I', Record, 0x54)
        if Item in (0, 0xFFFFFFFF):
            raise ValueError('invalid catalog item identity')
        NameOffset, = struct.unpack_from('<Q', Offsets, Index * 8)
        Content = []
        ContentCount = Record[0x200] & 7
        if ContentCount > 6:
            raise ValueError('unsupported content pointer count')
        for Slot in range(ContentCount):
            Pointer, = struct.unpack_from('<Q', Record, 0x10 + Slot * 8)
            Asset = CString(Pool, Pointer)
            if 'cdn/store/' + Asset in ManifestNames:
                Asset = 'cdn/store/' + Asset
                Matched.add(Asset)
            Content.append(Asset)
        Price, Final = struct.unpack_from('<II', Record, 0x1EC)
        Entry = {'item': f'0x{Item:08X}', 'name': CString(Names, NameOffset),
                 'price': Price & 0x3FFFFFF, 'finalPrice': Final & 0x3FFFFFF,
                 'content': Content}
        if Item in Items:
            Items[Item]['content'] = sorted(set(Items[Item]['content'] + Content))
        else:
            Items[Item] = Entry
    return Count, list(Items.values()), Matched


def Main(Manifest, Output):
    Assets = ReadManifest(Manifest)
    Archive = ReadAsset(Assets, 'store_binary_data.iff')
    with zipfile.ZipFile(io.BytesIO(Archive)) as Store:
        Files = {Info.filename: Store.read(Info) for Info in Store.infolist()
                 if Info.file_size <= 64 * 1024 * 1024}
    Count, Items, Matched = DecodeCatalog(Files, Assets)
    ManifestItems = {Name for Name in Assets if Name.startswith('cdn/store/clothing/win64/items/')
                     or Name.startswith('cdn/store/shoes/win64/data/')}
    Result = {'version': 1, 'source': 'NBA2K19_MANIFEST_STORE_BINARY_DATA',
              'manifestSha256': hashlib.sha256(Manifest.read_bytes()).hexdigest(),
              'archiveSha256': hashlib.sha256(Archive).hexdigest(),
              'nativeRecordCount': Count, 'matchedManifestAssets': len(Matched),
              'manifestItemAssets': len(ManifestItems), 'items': Items}
    Output.parent.mkdir(parents=True, exist_ok=True)
    Temporary = Output.with_suffix('.tmp')
    Temporary.write_text(json.dumps(Result, indent=2) + '\n', encoding='utf-8')
    Temporary.replace(Output)
    print(f'Imported {len(Items)} real item IDs from {Count} native records; '
          f'{len(Matched)} direct manifest asset references. Output: {Output}')


if __name__ == '__main__':
    Main(Path(sys.argv[1]), Path(sys.argv[2]))
