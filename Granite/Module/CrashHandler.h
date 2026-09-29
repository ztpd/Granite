// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

#pragma once

#include <windows.h>
#include <dbghelp.h>
#include <psapi.h>
#include <tlhelp32.h>
#include <intrin.h>

#include <cstdarg>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cwchar>

#include "MinHook/include/MinHook.h"

EXTERN_C IMAGE_DOS_HEADER __ImageBase;

namespace CrashHandler
{

inline constexpr unsigned __int64 IdaImageBase = 0x140000000ull;
inline constexpr DWORD VerifiedTimeDateStamp = 0x5C534BB5;
inline constexpr DWORD VerifiedSizeOfImage = 0x061D4000;
inline constexpr unsigned __int64 GameFilterStart = 0x14093F500ull;
inline constexpr unsigned __int64 GameFilterEnd = 0x14093FC9Full;
inline constexpr unsigned __int64 AssertWrapperA = 0x1418CAFE0ull;
inline constexpr unsigned __int64 AssertWrapperB = 0x1418CB150ull;
inline constexpr unsigned char AssertWrapperPrefix[15] = {0x4C, 0x8B, 0xDC, 0x49, 0x89, 0x5B, 0x08, 0x49,
                                                          0x89, 0x6B, 0x10, 0x49, 0x89, 0x73, 0x18};

struct SpinLock
{
    volatile LONG Held = 0;
    bool TryLock() noexcept { return InterlockedCompareExchange(&Held, 1, 0) == 0; }
    void Lock() noexcept
    {
        while (!TryLock()) YieldProcessor();
    }
    bool LockFor(unsigned Spins) noexcept
    {
        for (unsigned I = 0; I < Spins; ++I)
            if (TryLock()) return true;
        return false;
    }
    void Unlock() noexcept { InterlockedExchange(&Held, 0); }
};

inline bool Read(void* Out, ULONG_PTR Address, SIZE_T Size) noexcept
{
    SIZE_T Got = 0;
    return Address && ReadProcessMemory(GetCurrentProcess(), reinterpret_cast<LPCVOID>(Address), Out, Size, &Got) &&
           Got == Size;
}

inline SIZE_T ReadPartial(unsigned char* Out, ULONG_PTR Address, SIZE_T Size) noexcept
{
    SIZE_T Done = 0;
    while (Done < Size)
    {
        SIZE_T Chunk = Size - Done;
        const ULONG_PTR PageLeft = 0x1000 - ((Address + Done) & 0xFFF);
        if (Chunk > PageLeft) Chunk = PageLeft;
        if (!Read(Out + Done, Address + Done, Chunk)) break;
        Done += Chunk;
    }
    return Done;
}

inline void CopyAnsi(char* Out, size_t OutSize, const char* Source) noexcept
{
    if (!OutSize) return;
    Out[0] = 0;
    if (!Source) return;
    unsigned char Chunk[64];
    size_t Written = 0;
    ULONG_PTR At = reinterpret_cast<ULONG_PTR>(Source);
    while (Written + 1 < OutSize)
    {
        const SIZE_T Got = ReadPartial(Chunk, At, sizeof(Chunk));
        if (!Got) break;
        for (SIZE_T I = 0; I < Got && Written + 1 < OutSize; ++I)
        {
            if (!Chunk[I])
            {
                Out[Written] = 0;
                return;
            }
            Out[Written++] = (Chunk[I] >= 0x20 && Chunk[I] < 0x7F) ? static_cast<char>(Chunk[I]) : '?';
        }
        At += Got;
        if (Got < sizeof(Chunk)) break;
    }
    Out[Written] = 0;
}

inline void CopyWide(wchar_t* Out, size_t OutCount, const wchar_t* Source) noexcept
{
    if (!OutCount) return;
    Out[0] = 0;
    if (!Source) return;
    size_t Written = 0;
    ULONG_PTR At = reinterpret_cast<ULONG_PTR>(Source);
    while (Written + 1 < OutCount)
    {
        wchar_t C = 0;
        if (!Read(&C, At, sizeof(C)) || !C) break;
        Out[Written++] = C;
        At += sizeof(C);
    }
    Out[Written] = 0;
}

inline void Utf8(const wchar_t* Wide, int WideLength, char* Out, int OutSize) noexcept
{
    if (OutSize <= 0) return;
    Out[0] = 0;
    if (!Wide) return;
    const int Bytes = WideCharToMultiByte(CP_UTF8, 0, Wide, WideLength, Out, OutSize - 1, nullptr, nullptr);
    Out[Bytes > 0 ? (Bytes < OutSize ? Bytes : OutSize - 1) : 0] = 0;
}

inline void (*Sink)(const wchar_t*) = nullptr;
inline wchar_t Directory[MAX_PATH * 2] = {};
inline wchar_t SessionLogPath[MAX_PATH * 2] = {};
inline wchar_t SelfPath[MAX_PATH * 2] = {};
inline ULONG_PTR ExeBase = 0;
inline ULONG_PTR ExeSize = 0;
inline DWORD ExeTimeDateStamp = 0;
inline bool VerifiedBuild = false;
inline DWORD InstallTick = 0;
inline bool FullDump = false;
inline volatile LONG Installed = 0;

inline void Say(const wchar_t* Text) noexcept
{
    if (Sink) Sink(Text);
}

struct ModuleEntry
{
    ULONG_PTR Base;
    ULONG_PTR Size;
    DWORD Timestamp;
    wchar_t Path[MAX_PATH];
};
inline constexpr int MaxModules = 384;
inline ModuleEntry Modules[MaxModules];
inline ModuleEntry ModulesStaging[MaxModules];
inline int ModuleCount = 0;
inline SpinLock ModulesLock;

inline DWORD PeTimestamp(ULONG_PTR Base) noexcept
{
    IMAGE_DOS_HEADER Dos{};
    IMAGE_NT_HEADERS64 Nt{};
    if (!Read(&Dos, Base, sizeof(Dos)) || Dos.e_magic != IMAGE_DOS_SIGNATURE) return 0;
    if (!Read(&Nt, Base + static_cast<ULONG_PTR>(Dos.e_lfanew), sizeof(Nt)) || Nt.Signature != IMAGE_NT_SIGNATURE)
        return 0;
    return Nt.FileHeader.TimeDateStamp;
}

inline void RefreshModules() noexcept
{
    HANDLE Snapshot = INVALID_HANDLE_VALUE;
    for (int Attempt = 0; Attempt < 5 && Snapshot == INVALID_HANDLE_VALUE; ++Attempt)
    {
        Snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPMODULE, GetCurrentProcessId());
        if (Snapshot == INVALID_HANDLE_VALUE && GetLastError() != ERROR_BAD_LENGTH) break;
    }
    if (Snapshot == INVALID_HANDLE_VALUE) return;
    MODULEENTRY32W Entry{};
    Entry.dwSize = sizeof(Entry);
    int Count = 0;
    for (BOOL Ok = Module32FirstW(Snapshot, &Entry); Ok && Count < MaxModules; Ok = Module32NextW(Snapshot, &Entry))
    {
        ModuleEntry& Out = ModulesStaging[Count++];
        Out.Base = reinterpret_cast<ULONG_PTR>(Entry.modBaseAddr);
        Out.Size = Entry.modBaseSize;
        Out.Timestamp = PeTimestamp(Out.Base);
        wcsncpy_s(Out.Path, Entry.szExePath, _TRUNCATE);
    }
    CloseHandle(Snapshot);
    if (!Count) return;
    ModulesLock.Lock();
    memcpy(Modules, ModulesStaging, sizeof(ModuleEntry) * static_cast<size_t>(Count));
    ModuleCount = Count;
    ModulesLock.Unlock();
}

inline bool FindModule(ULONG_PTR Address, ModuleEntry& Out) noexcept
{
    bool Found = false;
    const bool Locked = ModulesLock.LockFor(200000);
    for (int I = 0; I < ModuleCount; ++I)
        if (Address >= Modules[I].Base && Address - Modules[I].Base < Modules[I].Size)
        {
            Out = Modules[I];
            Found = true;
            break;
        }
    if (Locked) ModulesLock.Unlock();
    return Found;
}

inline const wchar_t* BaseName(const wchar_t* Path) noexcept
{
    const wchar_t* Slash = wcsrchr(Path, L'\\');
    return Slash ? Slash + 1 : Path;
}

inline void Describe(ULONG_PTR Address, char* Out, size_t OutSize) noexcept
{
    ModuleEntry Module{};
    if (FindModule(Address, Module))
    {
        char Name[MAX_PATH]{};
        Utf8(BaseName(Module.Path), -1, Name, sizeof(Name));
        if (Module.Base == ExeBase)
            _snprintf_s(Out, OutSize, _TRUNCATE, "%s+0x%llX (IDA 0x%llX)", Name,
                        static_cast<unsigned long long>(Address - Module.Base),
                        static_cast<unsigned long long>(IdaImageBase + (Address - Module.Base)));
        else
            _snprintf_s(Out, OutSize, _TRUNCATE, "%s+0x%llX", Name,
                        static_cast<unsigned long long>(Address - Module.Base));
        return;
    }
    MEMORY_BASIC_INFORMATION Info{};
    if (Address && VirtualQuery(reinterpret_cast<LPCVOID>(Address), &Info, sizeof(Info)))
    {
        if (Info.State == MEM_COMMIT && Info.Type == MEM_IMAGE)
        {
            wchar_t Mapped[MAX_PATH]{};
            char Name[MAX_PATH]{};
            if (K32GetMappedFileNameW(GetCurrentProcess(), reinterpret_cast<LPVOID>(Address), Mapped, MAX_PATH))
                Utf8(BaseName(Mapped), -1, Name, sizeof(Name));
            _snprintf_s(Out, OutSize, _TRUNCATE, "%s+0x%llX (image, not in snapshot)", Name[0] ? Name : "<image>",
                        static_cast<unsigned long long>(Address - reinterpret_cast<ULONG_PTR>(Info.AllocationBase)));
            return;
        }
        const char* State = Info.State == MEM_COMMIT ? "committed" : Info.State == MEM_RESERVE ? "reserved" : "free";
        const char* Type = Info.Type == MEM_PRIVATE ? "private" : Info.Type == MEM_MAPPED ? "mapped" : "";
        _snprintf_s(Out, OutSize, _TRUNCATE, "<%s %s memory, protect 0x%lX>", State, Type, Info.Protect);
        return;
    }
    _snprintf_s(Out, OutSize, _TRUNCATE, "<unmapped>");
}

inline bool IsExecutableAddress(ULONG_PTR Address) noexcept
{
    ModuleEntry Module{};
    if (!FindModule(Address, Module)) return false;
    MEMORY_BASIC_INFORMATION Info{};
    if (!VirtualQuery(reinterpret_cast<LPCVOID>(Address), &Info, sizeof(Info))) return false;
    return (Info.Protect & (PAGE_EXECUTE | PAGE_EXECUTE_READ | PAGE_EXECUTE_READWRITE | PAGE_EXECUTE_WRITECOPY)) != 0;
}

inline constexpr int LogLines = 256;
inline constexpr int LogWidth = 480;
inline wchar_t LogRing[LogLines][LogWidth];
inline DWORD LogTicks[LogLines];
inline LONG LogNext = 0;
inline LONG LogTotal = 0;
inline SpinLock LogLock;

inline void RecordLogLine(const wchar_t* Text, size_t Length) noexcept
{
    if (!Text) return;
    while (Length && (Text[Length - 1] == L'\n' || Text[Length - 1] == L'\r')) --Length;
    if (Length >= LogWidth) Length = LogWidth - 1;
    LogLock.Lock();
    const LONG Slot = LogNext;
    wmemcpy(LogRing[Slot], Text, Length);
    LogRing[Slot][Length] = 0;
    LogTicks[Slot] = GetTickCount();
    LogNext = (Slot + 1) % LogLines;
    ++LogTotal;
    LogLock.Unlock();
}

struct AssertEntry
{
    DWORD Tick, Thread;
    int Line;
    long long Result;
    ULONG_PTR Caller;
    char Condition[96], Channel[48], Subchannel[64], Function[192], File[224];
    wchar_t Message[240];
};
inline constexpr int AssertSlots = 32;
inline AssertEntry Asserts[AssertSlots];
inline LONG AssertNext = 0;
inline LONG AssertTotal = 0;
inline SpinLock AssertLock;

using AssertFn = __int64(__fastcall*)(const char*, const char*, const char*, const char*, const char*, int,
                                      const wchar_t*, void*);
inline AssertFn AssertOriginalA = nullptr;
inline AssertFn AssertOriginalB = nullptr;

inline LONG BeginAssert(const char* Condition, const char* Channel, const char* Subchannel, const char* Function,
                        const char* File, int Line, const wchar_t* Message, ULONG_PTR Caller) noexcept
{
    AssertEntry Entry{};
    Entry.Tick = GetTickCount();
    Entry.Thread = GetCurrentThreadId();
    Entry.Line = Line;
    Entry.Result = -1;
    Entry.Caller = Caller;
    CopyAnsi(Entry.Condition, sizeof(Entry.Condition), Condition);
    CopyAnsi(Entry.Channel, sizeof(Entry.Channel), Channel);
    CopyAnsi(Entry.Subchannel, sizeof(Entry.Subchannel), Subchannel);
    CopyAnsi(Entry.Function, sizeof(Entry.Function), Function);
    CopyAnsi(Entry.File, sizeof(Entry.File), File);
    CopyWide(Entry.Message, _countof(Entry.Message), Message);
    AssertLock.Lock();
    const LONG Slot = AssertNext;
    Asserts[Slot] = Entry;
    AssertNext = (Slot + 1) % AssertSlots;
    ++AssertTotal;
    AssertLock.Unlock();
    return Slot;
}

inline void EndAssert(LONG Slot, DWORD Thread, __int64 Result) noexcept
{
    AssertLock.Lock();
    if (Asserts[Slot].Thread == Thread && Asserts[Slot].Result == -1) Asserts[Slot].Result = Result;
    AssertLock.Unlock();
}

inline __int64 __fastcall AssertHookA(const char* Condition, const char* Channel, const char* Subchannel,
                                      const char* Function, const char* File, int Line, const wchar_t* Message,
                                      void* Arguments)
{
    const LONG Slot = BeginAssert(Condition, Channel, Subchannel, Function, File, Line, Message,
                                  reinterpret_cast<ULONG_PTR>(_ReturnAddress()));
    const __int64 Result = AssertOriginalA(Condition, Channel, Subchannel, Function, File, Line, Message, Arguments);
    EndAssert(Slot, GetCurrentThreadId(), Result);
    return Result;
}

inline __int64 __fastcall AssertHookB(const char* Condition, const char* Channel, const char* Subchannel,
                                      const char* Function, const char* File, int Line, const wchar_t* Message,
                                      void* Arguments)
{
    const LONG Slot = BeginAssert(Condition, Channel, Subchannel, Function, File, Line, Message,
                                  reinterpret_cast<ULONG_PTR>(_ReturnAddress()));
    const __int64 Result = AssertOriginalB(Condition, Channel, Subchannel, Function, File, Line, Message, Arguments);
    EndAssert(Slot, GetCurrentThreadId(), Result);
    return Result;
}

inline constexpr unsigned __int64 GameWindowProc = 0x14196AD40ull;
inline constexpr unsigned char GameWindowProcPrefix[15] = {0x48, 0x89, 0x6C, 0x24, 0x10, 0x48, 0x89, 0x74,
                                                           0x24, 0x18, 0x48, 0x89, 0x7C, 0x24, 0x20};
struct CloseEntry
{
    DWORD Tick, Thread, SendFlags, ForegroundProcess;
    UINT Message;
    WPARAM WParam;
    LPARAM LParam;
    ULONG_PTR Caller;
};
inline constexpr int CloseSlots = 16;
inline CloseEntry Closes[CloseSlots];
inline LONG CloseNext = 0;
inline LONG CloseTotal = 0;
inline SpinLock CloseLock;

using WindowProcFn = LRESULT(__fastcall*)(HWND, UINT, WPARAM, LPARAM);
inline WindowProcFn WindowProcOriginal = nullptr;

inline const char* CloseMessageName(UINT Message, WPARAM WParam) noexcept
{
    switch (Message)
    {
    case WM_DESTROY: return "WM_DESTROY";
    case WM_CLOSE: return "WM_CLOSE";
    case WM_QUERYENDSESSION: return "WM_QUERYENDSESSION";
    case WM_ENDSESSION: return "WM_ENDSESSION";
    case WM_SYSCOMMAND: return (WParam & 0xFFF0) == SC_CLOSE ? "WM_SYSCOMMAND SC_CLOSE" : nullptr;
    case WM_NCLBUTTONDOWN: return WParam == HTCLOSE ? "WM_NCLBUTTONDOWN HTCLOSE (title bar close button)" : nullptr;
    case WM_SYSKEYDOWN: return WParam == VK_F4 ? "WM_SYSKEYDOWN VK_F4" : nullptr;
    default: return nullptr;
    }
}

inline const char* SendFlagsText(DWORD Flags) noexcept
{
    if ((Flags & ISMEX_SEND) && (Flags & ISMEX_REPLIED)) return "sent from another thread/process, already replied";
    if (Flags & ISMEX_SEND) return "sent from another thread/process";
    if (Flags & ISMEX_NOTIFY) return "SendNotifyMessage from another thread/process";
    if (Flags & ISMEX_CALLBACK) return "SendMessageCallback from another thread/process";
    return "posted, or sent by this window's own thread";
}

inline LRESULT __fastcall WindowProcHook(HWND Window, UINT Message, WPARAM WParam, LPARAM LParam)
{
    if (const char* Name = CloseMessageName(Message, WParam))
    {
        CloseEntry Entry{};
        Entry.Tick = GetTickCount();
        Entry.Thread = GetCurrentThreadId();
        Entry.SendFlags = InSendMessageEx(nullptr);
        if (HWND Foreground = GetForegroundWindow()) GetWindowThreadProcessId(Foreground, &Entry.ForegroundProcess);
        Entry.Message = Message;
        Entry.WParam = WParam;
        Entry.LParam = LParam;
        Entry.Caller = reinterpret_cast<ULONG_PTR>(_ReturnAddress());
        CloseLock.Lock();
        Closes[CloseNext] = Entry;
        CloseNext = (CloseNext + 1) % CloseSlots;
        ++CloseTotal;
        CloseLock.Unlock();

        char Where[512] = {};
        Describe(Entry.Caller, Where, sizeof(Where));
        wchar_t Line[900];
        swprintf_s(
            Line,
            L"[crash] window message %S wParam=0x%llX lParam=0x%llX: %S; foreground process %lu (this process %lu); window procedure called from %S",
            Name, static_cast<unsigned long long>(WParam), static_cast<unsigned long long>(LParam),
            SendFlagsText(Entry.SendFlags), Entry.ForegroundProcess, GetCurrentProcessId(), Where);
        Say(Line);
    }
    return WindowProcOriginal(Window, Message, WParam, LParam);
}

inline constexpr int FrameSlots = 32;
struct ExceptionEntry
{
    DWORD Tick, Thread;
    EXCEPTION_RECORD Record;
    ULONG_PTR Rsp;
    ULONG_PTR Frames[FrameSlots];
    int FrameCount;
};
inline constexpr int ExceptionSlots = 24;
inline ExceptionEntry Exceptions[ExceptionSlots];
inline LONG ExceptionNext = 0;
inline LONG ExceptionTotal = 0;
inline volatile LONG LastFatalTick = 0;
inline volatile LONG AnyFatalSeen = 0;
inline SpinLock ExceptionLock;
inline DWORD WriterThreadId = 0;
inline thread_local bool InObserver = false;

inline int UnwindFrames(CONTEXT Context, ULONG_PTR* Frames, ULONG_PTR* Stacks, int Max) noexcept
{
    int Count = 0;
    __try
    {
        while (Count < Max)
        {
            Frames[Count] = static_cast<ULONG_PTR>(Context.Rip);
            if (Stacks) Stacks[Count] = static_cast<ULONG_PTR>(Context.Rsp);
            ++Count;
            if (!Context.Rip) break;
            const DWORD64 PreviousRsp = Context.Rsp;
            const DWORD64 PreviousRip = Context.Rip;
            DWORD64 ImageBase = 0;
            const PRUNTIME_FUNCTION Function = RtlLookupFunctionEntry(Context.Rip, &ImageBase, nullptr);
            if (Function)
            {
                PVOID HandlerData = nullptr;
                DWORD64 Establisher = 0;
                RtlVirtualUnwind(UNW_FLAG_NHANDLER, ImageBase, Context.Rip, Function, &Context, &HandlerData,
                                 &Establisher, nullptr);
            }
            else
            {
                ULONG_PTR ReturnAddress = 0;
                if (!Read(&ReturnAddress, static_cast<ULONG_PTR>(Context.Rsp), sizeof(ReturnAddress))) break;
                Context.Rip = ReturnAddress;
                Context.Rsp += sizeof(ULONG_PTR);
            }
            if (!Context.Rip || (Context.Rsp <= PreviousRsp && Context.Rip == PreviousRip)) break;
        }
    }
    __except (EXCEPTION_EXECUTE_HANDLER)
    {
    }
    return Count;
}

inline bool IsErrorClass(DWORD Code) noexcept
{
    switch (Code)
    {
    case 0x40010006:
    case 0x4001000A:
    case 0x406D1388:
    case EXCEPTION_SINGLE_STEP: return false;
    case EXCEPTION_BREAKPOINT:
    case EXCEPTION_DATATYPE_MISALIGNMENT:
    case 0xE06D7363: return true;
    default: return (Code & 0xC0000000u) == 0xC0000000u;
    }
}

inline LONG CALLBACK VectoredObserver(EXCEPTION_POINTERS* Info)
{
    if (!Info || !Info->ExceptionRecord || !Info->ContextRecord) return EXCEPTION_CONTINUE_SEARCH;
    const DWORD Code = Info->ExceptionRecord->ExceptionCode;
    if (!IsErrorClass(Code) || InObserver || GetCurrentThreadId() == WriterThreadId) return EXCEPTION_CONTINUE_SEARCH;
    InObserver = true;
    ExceptionEntry* Entry = nullptr;
    ExceptionLock.Lock();
    const LONG Slot = ExceptionNext;
    ExceptionNext = (Slot + 1) % ExceptionSlots;
    ++ExceptionTotal;
    ExceptionLock.Unlock();
    Entry = &Exceptions[Slot];
    Entry->Tick = GetTickCount();
    Entry->Thread = GetCurrentThreadId();
    Entry->Record = *Info->ExceptionRecord;
    Entry->Rsp = static_cast<ULONG_PTR>(Info->ContextRecord->Rsp);
    if (Code == EXCEPTION_STACK_OVERFLOW)
    {
        Entry->Frames[0] = static_cast<ULONG_PTR>(Info->ContextRecord->Rip);
        Entry->FrameCount = 1;
    }
    else
    {
        Entry->FrameCount = UnwindFrames(*Info->ContextRecord, Entry->Frames, nullptr, FrameSlots);
    }
    if (Code != EXCEPTION_BREAKPOINT && Code != 0xE06D7363)
    {
        InterlockedExchange(&LastFatalTick, static_cast<LONG>(Entry->Tick));
        InterlockedExchange(&AnyFatalSeen, 1);
    }
    InObserver = false;
    return EXCEPTION_CONTINUE_SEARCH;
}

enum class Trigger
{
    Unhandled,
    FailFast,
    TerminateProcess,
    ExitProcess,
    Manual
};

inline const char* TriggerName(Trigger Trigger) noexcept
{
    switch (Trigger)
    {
    case Trigger::Unhandled: return "unhandled exception (top-level filter)";
    case Trigger::FailFast: return "RaiseFailFastException";
    case Trigger::TerminateProcess: return "TerminateProcess on this process";
    case Trigger::ExitProcess: return "ExitProcess / RtlExitUserProcess";
    default: return "manual";
    }
}

struct Request
{
    Trigger Trigger;
    bool HasRecord;
    bool Full;
    DWORD Thread;
    UINT ExitCode;
    ULONG_PTR Caller;
    EXCEPTION_RECORD Record;
    CONTEXT Context;
    EXCEPTION_POINTERS Pointers;
};

inline Request Pending{};
inline HANDLE RequestEvent = nullptr;
inline HANDLE DoneEvent = nullptr;
inline SpinLock RequestLock;
inline volatile LONG CrashReportWritten = 0;
inline wchar_t LastReportPath[MAX_PATH * 2] = {};
inline volatile LONG InsideGameFilter = 0;

inline HANDLE Out = INVALID_HANDLE_VALUE;
inline char OutBuffer[1 << 16];
inline size_t OutLength = 0;

inline void Flush() noexcept
{
    if (Out != INVALID_HANDLE_VALUE && OutLength)
    {
        DWORD Wrote = 0;
        WriteFile(Out, OutBuffer, static_cast<DWORD>(OutLength), &Wrote, nullptr);
        FlushFileBuffers(Out);
    }
    OutLength = 0;
}

inline void Put(const char* Format, ...) noexcept
{
    char Line[4096];
    va_list Arguments;
    va_start(Arguments, Format);
    const int Length = _vsnprintf_s(Line, sizeof(Line), _TRUNCATE, Format, Arguments);
    va_end(Arguments);
    const size_t Bytes = Length < 0 ? strlen(Line) : static_cast<size_t>(Length);
    if (OutLength + Bytes > sizeof(OutBuffer)) Flush();
    memcpy(OutBuffer + OutLength, Line, Bytes);
    OutLength += Bytes;
}

inline const char* ExceptionName(DWORD Code) noexcept
{
    switch (Code)
    {
    case 0xC0000005: return "EXCEPTION_ACCESS_VIOLATION";
    case 0xC0000006: return "EXCEPTION_IN_PAGE_ERROR";
    case 0xC0000008: return "STATUS_INVALID_HANDLE";
    case 0xC000001D: return "EXCEPTION_ILLEGAL_INSTRUCTION";
    case 0xC0000025: return "EXCEPTION_NONCONTINUABLE_EXCEPTION";
    case 0xC0000026: return "EXCEPTION_INVALID_DISPOSITION";
    case 0xC000008C: return "EXCEPTION_ARRAY_BOUNDS_EXCEEDED";
    case 0xC000008D: return "EXCEPTION_FLT_DENORMAL_OPERAND";
    case 0xC000008E: return "EXCEPTION_FLT_DIVIDE_BY_ZERO";
    case 0xC000008F: return "EXCEPTION_FLT_INEXACT_RESULT";
    case 0xC0000090: return "EXCEPTION_FLT_INVALID_OPERATION";
    case 0xC0000091: return "EXCEPTION_FLT_OVERFLOW";
    case 0xC0000092: return "EXCEPTION_FLT_STACK_CHECK";
    case 0xC0000093: return "EXCEPTION_FLT_UNDERFLOW";
    case 0xC0000094: return "EXCEPTION_INT_DIVIDE_BY_ZERO";
    case 0xC0000095: return "EXCEPTION_INT_OVERFLOW";
    case 0xC0000096: return "EXCEPTION_PRIV_INSTRUCTION";
    case 0xC00000FD: return "EXCEPTION_STACK_OVERFLOW";
    case 0xC0000017: return "STATUS_NO_MEMORY";
    case 0xC000013A: return "STATUS_CONTROL_C_EXIT";
    case 0xC0000142: return "STATUS_DLL_INIT_FAILED";
    case 0xC0000374: return "STATUS_HEAP_CORRUPTION";
    case 0xC0000409: return "STATUS_STACK_BUFFER_OVERRUN (fail fast / __fastfail)";
    case 0xC0000417: return "STATUS_INVALID_CRUNTIME_PARAMETER";
    case 0xC0000420: return "STATUS_ASSERTION_FAILURE";
    case 0xC0000602: return "STATUS_FAIL_FAST_EXCEPTION";
    case 0x80000002: return "EXCEPTION_DATATYPE_MISALIGNMENT";
    case 0x80000003: return "EXCEPTION_BREAKPOINT (int 3 / __debugbreak)";
    case 0x80000004: return "EXCEPTION_SINGLE_STEP";
    case 0xE06D7363: return "C++ exception (throw)";
    case 0x40000015: return "STATUS_FATAL_APP_EXIT (abort)";
    default: return "";
    }
}

inline void PutAddressLine(const char* Label, ULONG_PTR Address) noexcept
{
    char Where[512];
    Describe(Address, Where, sizeof(Where));
    Put("%s0x%016llX  %s\r\n", Label, static_cast<unsigned long long>(Address), Where);
}

inline bool TextAt(ULONG_PTR Address, char* Text, size_t OutSize) noexcept
{
    Text[0] = 0;
    if (Address < 0x10000) return false;
    unsigned char Bytes[128];
    const SIZE_T Got = ReadPartial(Bytes, Address, sizeof(Bytes));
    if (Got < 5) return false;
    size_t Ascii = 0;
    while (Ascii < Got && Bytes[Ascii] >= 0x20 && Bytes[Ascii] < 0x7F) ++Ascii;
    if (Ascii >= 4 && (Ascii == Got || Bytes[Ascii] == 0))
    {
        _snprintf_s(Text, OutSize, _TRUNCATE, "\"%.*s%s\"", static_cast<int>(Ascii),
                    reinterpret_cast<const char*>(Bytes), Ascii == Got ? "..." : "");
        return true;
    }
    size_t Wide = 0;
    while (Wide + 1 < Got && Bytes[Wide] >= 0x20 && Bytes[Wide] < 0x7F && Bytes[Wide + 1] == 0) Wide += 2;
    if (Wide >= 8)
    {
        char Narrow[64];
        size_t N = 0;
        for (size_t I = 0; I < Wide && N + 1 < sizeof(Narrow); I += 2) Narrow[N++] = static_cast<char>(Bytes[I]);
        Narrow[N] = 0;
        _snprintf_s(Text, OutSize, _TRUNCATE, "L\"%s%s\"", Narrow, Wide + 1 >= Got ? "..." : "");
        return true;
    }
    return false;
}

inline void PutValue(const char* Label, ULONG_PTR Value) noexcept
{
    char Where[512] = {};
    char Text[200] = {};
    ModuleEntry Module{};
    if (FindModule(Value, Module)) Describe(Value, Where, sizeof(Where));
    TextAt(Value, Text, sizeof(Text));
    if (!Where[0] && !Text[0])
    {
        unsigned char Bytes[16];
        if (Value >= 0x10000 && Read(Bytes, Value, sizeof(Bytes)))
        {
            char Hex[64] = {};
            for (int I = 0; I < 16; ++I) _snprintf_s(Hex + I * 3, sizeof(Hex) - I * 3, _TRUNCATE, "%02X ", Bytes[I]);
            _snprintf_s(Where, sizeof(Where), _TRUNCATE, "-> %s", Hex);
        }
    }
    Put("  %s = 0x%016llX  %s %s\r\n", Label, static_cast<unsigned long long>(Value), Where, Text);
}

inline void PutCppException(const EXCEPTION_RECORD& Record) noexcept
{
    if (Record.NumberParameters < 4) return;
    const ULONG_PTR Object = Record.ExceptionInformation[1];
    const ULONG_PTR ThrowInfo = Record.ExceptionInformation[2];
    const ULONG_PTR ImageBase = Record.ExceptionInformation[3];
    Put("  C++ magic 0x%llX, object 0x%llX, ThrowInfo 0x%llX, image base 0x%llX\r\n",
        static_cast<unsigned long long>(Record.ExceptionInformation[0]), static_cast<unsigned long long>(Object),
        static_cast<unsigned long long>(ThrowInfo), static_cast<unsigned long long>(ImageBase));
    struct
    {
        DWORD Attributes;
        int Unwind;
        int Forward;
        int Catchable;
    } Info{};
    if (!ThrowInfo || !Read(&Info, ThrowInfo, sizeof(Info)) || !Info.Catchable) return;
    int TypeCount = 0;
    if (!Read(&TypeCount, ImageBase + static_cast<ULONG_PTR>(Info.Catchable), sizeof(TypeCount))) return;
    bool IsStdException = false;
    for (int I = 0; I < TypeCount && I < 16; ++I)
    {
        int TypeRva = 0;
        if (!Read(&TypeRva, ImageBase + static_cast<ULONG_PTR>(Info.Catchable) + 4 + static_cast<ULONG_PTR>(I) * 4,
                  sizeof(TypeRva)))
            break;
        int DescriptorRva = 0;
        if (!Read(&DescriptorRva, ImageBase + static_cast<ULONG_PTR>(TypeRva) + 4, sizeof(DescriptorRva))) break;
        char Name[160] = {};
        CopyAnsi(Name, sizeof(Name),
                 reinterpret_cast<const char*>(ImageBase + static_cast<ULONG_PTR>(DescriptorRva) + 16));
        Put("  thrown type[%d]: %s\r\n", I, Name);
        if (strcmp(Name, ".?AVexception@std@@") == 0) IsStdException = true;
    }
    ULONG_PTR What = 0;
    if (IsStdException && Read(&What, Object + sizeof(ULONG_PTR), sizeof(What)) && What)
    {
        char Text[512] = {};
        CopyAnsi(Text, sizeof(Text), reinterpret_cast<const char*>(What));
        Put("  std::exception::what(): \"%s\"\r\n", Text);
    }
}

inline void PutExceptionDetail(const EXCEPTION_RECORD& Record) noexcept
{
    const DWORD Code = Record.ExceptionCode;
    Put("Exception code:    0x%08lX %s\r\n", Code, ExceptionName(Code));
    Put("Exception flags:   0x%08lX%s\r\n", Record.ExceptionFlags,
        (Record.ExceptionFlags & EXCEPTION_NONCONTINUABLE) ? " (noncontinuable)" : "");
    PutAddressLine("Exception address: ", static_cast<ULONG_PTR>(reinterpret_cast<ULONG_PTR>(Record.ExceptionAddress)));
    for (DWORD I = 0; I < Record.NumberParameters && I < EXCEPTION_MAXIMUM_PARAMETERS; ++I)
        Put("  parameter[%lu] = 0x%016llX\r\n", I, static_cast<unsigned long long>(Record.ExceptionInformation[I]));
    if ((Code == 0xC0000005 || Code == 0xC0000006) && Record.NumberParameters >= 2)
    {
        const ULONG_PTR Operation = Record.ExceptionInformation[0];
        const char* Verb = Operation == 0   ? "READ from"
                           : Operation == 1 ? "WRITE to"
                           : Operation == 8 ? "EXECUTE (DEP) at"
                                            : "access";
        char Where[512];
        Describe(Record.ExceptionInformation[1], Where, sizeof(Where));
        Put("Reason:            attempted to %s 0x%016llX  %s%s\r\n", Verb,
            static_cast<unsigned long long>(Record.ExceptionInformation[1]), Where,
            Record.ExceptionInformation[1] < 0x10000 ? "  (null or near-null pointer)" : "");
        if (Code == 0xC0000006 && Record.NumberParameters >= 3)
            Put("                   underlying NTSTATUS 0x%08llX\r\n",
                static_cast<unsigned long long>(Record.ExceptionInformation[2]));
    }
    else if (Code == 0xE06D7363)
    {
        PutCppException(Record);
    }
    else if (Code == EXCEPTION_BREAKPOINT)
    {
        ModuleEntry Module{};
        if (FindModule(reinterpret_cast<ULONG_PTR>(Record.ExceptionAddress), Module) && Module.Base == ExeBase)
            Put("Reason:            int 3 inside NBA2K19.exe -- the game's VCASSERT pattern is `if (assert(...)) __debugbreak();`; see the game asserts below\r\n");
    }
    else if (Code == EXCEPTION_STACK_OVERFLOW)
    {
        Put("Reason:            the faulting thread ran out of stack (deep or unbounded recursion, or a huge stack allocation)\r\n");
    }
    else if (Code == 0xC0000374)
    {
        Put("Reason:            the heap manager detected corruption (a write past a block, double free, or use after free earlier)\r\n");
    }
}

inline void PutStackFrames(const CONTEXT& Context) noexcept
{
    ULONG_PTR Frames[96]{};
    ULONG_PTR Stacks[96]{};
    const int Count = UnwindFrames(Context, Frames, Stacks, 96);
    Put("\r\n== Call stack of the faulting thread (x64 unwind tables) ==\r\n");
    for (int I = 0; I < Count; ++I)
    {
        char Where[512];
        Describe(Frames[I], Where, sizeof(Where));
        Put("  #%02d rip 0x%016llX rsp 0x%016llX  %s\r\n", I, static_cast<unsigned long long>(Frames[I]),
            static_cast<unsigned long long>(Stacks[I]), Where);
    }
}

inline void PutStackScan(ULONG_PTR Rsp) noexcept
{
    Put("\r\n== Stack scan from RSP (values that point at code or text; return addresses of earlier frames and "
        "string arguments such as assert files/functions show up here even when unwinding fails) ==\r\n");
    static ULONG_PTR Slots[2048];
    const SIZE_T Got = ReadPartial(reinterpret_cast<unsigned char*>(Slots), Rsp, sizeof(Slots)) / sizeof(ULONG_PTR);
    int Printed = 0;
    for (SIZE_T I = 0; I < Got && Printed < 220; ++I)
    {
        const ULONG_PTR Value = Slots[I];
        if (Value < 0x10000) continue;
        char Text[200] = {};
        const bool Code = IsExecutableAddress(Value);
        if (!Code && !TextAt(Value, Text, sizeof(Text))) continue;
        char Where[512] = {};
        if (Code) Describe(Value, Where, sizeof(Where));
        Put("  rsp+0x%04llX: 0x%016llX  %s%s\r\n", static_cast<unsigned long long>(I * sizeof(ULONG_PTR)),
            static_cast<unsigned long long>(Value), Code ? Where : "", Text);
        ++Printed;
    }
    Put("  raw (first 48 slots):\r\n");
    for (SIZE_T I = 0; I < Got && I < 48; I += 4)
    {
        Put("  rsp+0x%04llX:", static_cast<unsigned long long>(I * sizeof(ULONG_PTR)));
        for (SIZE_T J = I; J < I + 4 && J < Got; ++J) Put(" %016llX", static_cast<unsigned long long>(Slots[J]));
        Put("\r\n");
    }
}

inline void PutRegisters(const CONTEXT& C) noexcept
{
    Put("\r\n== Registers ==\r\n");
    PutValue("RIP", static_cast<ULONG_PTR>(C.Rip));
    PutValue("RSP", static_cast<ULONG_PTR>(C.Rsp));
    PutValue("RBP", static_cast<ULONG_PTR>(C.Rbp));
    PutValue("RAX", static_cast<ULONG_PTR>(C.Rax));
    PutValue("RBX", static_cast<ULONG_PTR>(C.Rbx));
    PutValue("RCX", static_cast<ULONG_PTR>(C.Rcx));
    PutValue("RDX", static_cast<ULONG_PTR>(C.Rdx));
    PutValue("RSI", static_cast<ULONG_PTR>(C.Rsi));
    PutValue("RDI", static_cast<ULONG_PTR>(C.Rdi));
    PutValue("R8 ", static_cast<ULONG_PTR>(C.R8));
    PutValue("R9 ", static_cast<ULONG_PTR>(C.R9));
    PutValue("R10", static_cast<ULONG_PTR>(C.R10));
    PutValue("R11", static_cast<ULONG_PTR>(C.R11));
    PutValue("R12", static_cast<ULONG_PTR>(C.R12));
    PutValue("R13", static_cast<ULONG_PTR>(C.R13));
    PutValue("R14", static_cast<ULONG_PTR>(C.R14));
    PutValue("R15", static_cast<ULONG_PTR>(C.R15));
    Put("  EFLAGS = 0x%08lX  CS=%04X SS=%04X DS=%04X ES=%04X FS=%04X GS=%04X  MXCSR=0x%08lX\r\n", C.EFlags, C.SegCs,
        C.SegSs, C.SegDs, C.SegEs, C.SegFs, C.SegGs, C.MxCsr);
    Put("  DR0=%llX DR1=%llX DR2=%llX DR3=%llX DR6=%llX DR7=%llX (build probes use the debug registers)\r\n",
        static_cast<unsigned long long>(C.Dr0), static_cast<unsigned long long>(C.Dr1),
        static_cast<unsigned long long>(C.Dr2), static_cast<unsigned long long>(C.Dr3),
        static_cast<unsigned long long>(C.Dr6), static_cast<unsigned long long>(C.Dr7));

    unsigned char Code[64];
    const ULONG_PTR Start = static_cast<ULONG_PTR>(C.Rip) - 24;
    const SIZE_T Got = ReadPartial(Code, Start, sizeof(Code));
    if (Got)
    {
        Put("  code bytes at RIP-24 (RIP is marked with []):\r\n   ");
        for (SIZE_T I = 0; I < Got; ++I) Put(I == 24 ? " [%02X]" : " %02X", Code[I]);
        Put("\r\n");
    }
    else
    {
        Put("  code bytes at RIP: unreadable (RIP points at unmapped memory -- a call through a bad pointer or a smashed return address)\r\n");
    }
}

inline void PutAsserts() noexcept
{
    const DWORD Now = GetTickCount();
    const bool Locked = AssertLock.LockFor(200000);
    Put("\r\n== Game asserts (VCASSERT wrappers sub_1418CAFE0/sub_1418CB150), most recent first; %ld total ==\r\n",
        AssertTotal);
    if (!VerifiedBuild) Put("  not recorded: NBA2K19.exe is not the verified build\r\n");
    const LONG Total = AssertTotal < AssertSlots ? AssertTotal : AssertSlots;
    for (LONG I = 0; I < Total; ++I)
    {
        const AssertEntry& A = Asserts[(AssertNext - 1 - I + AssertSlots) % AssertSlots];
        char Message[512] = {};
        Utf8(A.Message, -1, Message, sizeof(Message));
        char Where[512] = {};
        Describe(A.Caller, Where, sizeof(Where));
        Put("  [%lu ms before report] thread %lu %s/%s %s  %s:%d  cond \"%s\"  msg \"%s\"  result %lld  called from %s\r\n",
            Now - A.Tick, A.Thread, A.Channel, A.Subchannel, A.Function, A.File, A.Line, A.Condition, Message, A.Result,
            Where);
    }
    if (Locked) AssertLock.Unlock();
}

inline void PutCloseMessages() noexcept
{
    const DWORD Now = GetTickCount();
    const bool Locked = CloseLock.LockFor(200000);
    Put("\r\n== Close messages received by the game window (sub_14196AD40), most recent first; %ld total ==\r\n",
        CloseTotal);
    if (!WindowProcOriginal) Put("  not recorded: the window procedure hook is not armed\r\n");
    const LONG Total = CloseTotal < CloseSlots ? CloseTotal : CloseSlots;
    for (LONG I = 0; I < Total; ++I)
    {
        const CloseEntry& C = Closes[(CloseNext - 1 - I + CloseSlots) % CloseSlots];
        char Where[512] = {};
        Describe(C.Caller, Where, sizeof(Where));
        Put("  [%lu ms before report] thread %lu %s wParam=0x%llX lParam=0x%llX  %s (InSendMessageEx 0x%08lX)  foreground process %lu  called from %s\r\n",
            Now - C.Tick, C.Thread, CloseMessageName(C.Message, C.WParam), static_cast<unsigned long long>(C.WParam),
            static_cast<unsigned long long>(C.LParam), SendFlagsText(C.SendFlags), C.SendFlags, C.ForegroundProcess,
            Where);
    }
    if (Locked) CloseLock.Unlock();
}

inline void PutRecentExceptions() noexcept
{
    const DWORD Now = GetTickCount();
    const bool Locked = ExceptionLock.LockFor(200000);
    Put("\r\n== First-chance error-class exceptions, most recent first; %ld total (many are handled by the game and harmless) ==\r\n",
        ExceptionTotal);
    const LONG Total = ExceptionTotal < ExceptionSlots ? ExceptionTotal : ExceptionSlots;
    for (LONG I = 0; I < Total; ++I)
    {
        const ExceptionEntry& E = Exceptions[(ExceptionNext - 1 - I + ExceptionSlots) % ExceptionSlots];
        char Where[512];
        Describe(reinterpret_cast<ULONG_PTR>(E.Record.ExceptionAddress), Where, sizeof(Where));
        Put("  [%lu ms before report] thread %lu code 0x%08lX %s at %s", Now - E.Tick, E.Thread, E.Record.ExceptionCode,
            ExceptionName(E.Record.ExceptionCode), Where);
        if (E.Record.ExceptionCode == 0xC0000005 && E.Record.NumberParameters >= 2)
            Put("  (%s 0x%llX)",
                E.Record.ExceptionInformation[0] == 1   ? "write"
                : E.Record.ExceptionInformation[0] == 8 ? "execute"
                                                        : "read",
                static_cast<unsigned long long>(E.Record.ExceptionInformation[1]));
        Put("\r\n");
        for (int F = 1; F < E.FrameCount && F < 12; ++F)
        {
            Describe(E.Frames[F], Where, sizeof(Where));
            Put("      #%02d %s\r\n", F, Where);
        }
    }
    if (Locked) ExceptionLock.Unlock();
}

inline void PutLogTail() noexcept
{
    const bool Locked = LogLock.LockFor(200000);
    const LONG Total = LogTotal < LogLines ? LogTotal : LogLines;
    const DWORD Now = GetTickCount();
    Put("\r\n== Last %ld Granite log lines (oldest first) ==\r\n", Total);
    char Line[LogWidth * 3];
    for (LONG I = Total; I > 0; --I)
    {
        const LONG Slot = (LogNext - I + LogLines) % LogLines;
        Utf8(LogRing[Slot], -1, Line, sizeof(Line));
        Put("  [-%lu ms] %s\r\n", Now - LogTicks[Slot], Line);
    }
    if (Locked) LogLock.Unlock();
}

inline void PutEnvironment() noexcept
{
    Put("\r\n== Process ==\r\n");
    wchar_t Exe[MAX_PATH]{};
    char ExeUtf8[MAX_PATH * 3]{};
    GetModuleFileNameW(nullptr, Exe, MAX_PATH);
    Utf8(Exe, -1, ExeUtf8, sizeof(ExeUtf8));
    Put("  executable %s base 0x%llX size 0x%llX TimeDateStamp 0x%08lX (%s build)\r\n", ExeUtf8,
        static_cast<unsigned long long>(ExeBase), static_cast<unsigned long long>(ExeSize), ExeTimeDateStamp,
        VerifiedBuild ? "verified 5C534BB5" : "UNVERIFIED");
    char Self[MAX_PATH * 3]{};
    Utf8(SelfPath, -1, Self, sizeof(Self));
    Put("  granite module %s\r\n", Self);
    Put("  uptime since module start %lu ms\r\n", GetTickCount() - InstallTick);
    PROCESS_MEMORY_COUNTERS_EX Memory{};
    Memory.cb = sizeof(Memory);
    if (K32GetProcessMemoryInfo(GetCurrentProcess(), reinterpret_cast<PPROCESS_MEMORY_COUNTERS>(&Memory),
                                sizeof(Memory)))
        Put("  working set %llu MB (peak %llu MB), private %llu MB, pagefile %llu MB\r\n",
            static_cast<unsigned long long>(Memory.WorkingSetSize >> 20),
            static_cast<unsigned long long>(Memory.PeakWorkingSetSize >> 20),
            static_cast<unsigned long long>(Memory.PrivateUsage >> 20),
            static_cast<unsigned long long>(Memory.PagefileUsage >> 20));
    MEMORYSTATUSEX System{};
    System.dwLength = sizeof(System);
    if (GlobalMemoryStatusEx(&System))
        Put("  system memory load %lu%%, physical free %llu MB of %llu MB, commit free %llu MB\r\n",
            System.dwMemoryLoad, static_cast<unsigned long long>(System.ullAvailPhys >> 20),
            static_cast<unsigned long long>(System.ullTotalPhys >> 20),
            static_cast<unsigned long long>(System.ullAvailPageFile >> 20));
    using RtlGetVersionFn = LONG(WINAPI*)(OSVERSIONINFOW*);
    if (const HMODULE Ntdll = GetModuleHandleW(L"ntdll.dll"))
        if (const auto GetVersion = reinterpret_cast<RtlGetVersionFn>(GetProcAddress(Ntdll, "RtlGetVersion")))
        {
            OSVERSIONINFOW Version{};
            Version.dwOSVersionInfoSize = sizeof(Version);
            if (GetVersion(&Version) == 0)
                Put("  Windows %lu.%lu build %lu\r\n", Version.dwMajorVersion, Version.dwMinorVersion,
                    Version.dwBuildNumber);
        }
    Put("  game's own crash files (written by its filter after this report): %%APPDATA%%\\2K Sports\\NBA 2K19\\CrashReport.txt / CrashReport.dmp\r\n");
}

inline void PutModules() noexcept
{
    const bool Locked = ModulesLock.LockFor(200000);
    Put("\r\n== Loaded modules (%d) ==\r\n", ModuleCount);
    char Path[MAX_PATH * 3];
    for (int I = 0; I < ModuleCount; ++I)
    {
        Utf8(Modules[I].Path, -1, Path, sizeof(Path));
        Put("  0x%016llX-0x%016llX ts 0x%08lX %s\r\n", static_cast<unsigned long long>(Modules[I].Base),
            static_cast<unsigned long long>(Modules[I].Base + Modules[I].Size), Modules[I].Timestamp, Path);
    }
    if (Locked) ModulesLock.Unlock();
}

inline void PutSymbols(const CONTEXT& Context) noexcept
{
    ULONG_PTR Frames[64]{};
    const int Count = UnwindFrames(Context, Frames, nullptr, 64);
    Put("\r\n== Call stack symbols (DbgHelp; NBA2K19.exe has no PDB, use the IDA addresses above) ==\r\n");
    const HANDLE Process = GetCurrentProcess();
    wchar_t searchPath[MAX_PATH * 4]{};
    wchar_t SelfDirectory[MAX_PATH * 2]{};
    wcsncpy_s(SelfDirectory, SelfPath, _TRUNCATE);
    if (wchar_t* Slash = wcsrchr(SelfDirectory, L'\\')) *Slash = 0;
    wchar_t System[MAX_PATH]{};
    GetSystemDirectoryW(System, MAX_PATH);
    swprintf_s(searchPath, L"%s;%s", SelfDirectory, System);
    SymSetOptions(SYMOPT_UNDNAME | SYMOPT_DEFERRED_LOADS | SYMOPT_FAIL_CRITICAL_ERRORS | SYMOPT_NO_PROMPTS |
                  SYMOPT_LOAD_LINES);
    if (!SymInitializeW(Process, searchPath, TRUE))
    {
        Put("  SymInitialize failed (%lu)\r\n", GetLastError());
        return;
    }
    static unsigned char SymbolBuffer[sizeof(SYMBOL_INFOW) + 512 * sizeof(wchar_t)];
    for (int I = 0; I < Count; ++I)
    {
        memset(SymbolBuffer, 0, sizeof(SymbolBuffer));
        auto* Symbol = reinterpret_cast<SYMBOL_INFOW*>(SymbolBuffer);
        Symbol->SizeOfStruct = sizeof(SYMBOL_INFOW);
        Symbol->MaxNameLen = 511;
        DWORD64 Displacement = 0;
        char Where[512];
        Describe(Frames[I], Where, sizeof(Where));
        ModuleEntry Module{};
        const bool InExe = FindModule(Frames[I], Module) && Module.Base == ExeBase;
        if (!InExe && SymFromAddrW(Process, Frames[I], &Displacement, Symbol))
        {
            char Name[1024];
            Utf8(Symbol->Name, -1, Name, sizeof(Name));
            IMAGEHLP_LINEW64 Line{};
            Line.SizeOfStruct = sizeof(Line);
            DWORD LineDisplacement = 0;
            if (SymGetLineFromAddrW64(Process, Frames[I], &LineDisplacement, &Line))
            {
                char File[MAX_PATH * 3];
                Utf8(Line.FileName, -1, File, sizeof(File));
                Put("  #%02d %s  %s+0x%llX  [%s:%lu]\r\n", I, Where, Name,
                    static_cast<unsigned long long>(Displacement), File, Line.LineNumber);
            }
            else
            {
                Put("  #%02d %s  %s+0x%llX\r\n", I, Where, Name, static_cast<unsigned long long>(Displacement));
            }
        }
        else
        {
            Put("  #%02d %s\r\n", I, Where);
        }
    }
    SymCleanup(Process);
}

inline void OpenReport(const wchar_t* Kind, wchar_t* PathOut, size_t PathCount) noexcept
{
    SYSTEMTIME Now{};
    GetLocalTime(&Now);
    swprintf_s(PathOut, PathCount, L"%s\\granite-%s-%04u%02u%02u-%02u%02u%02u-%lu.txt", Directory, Kind, Now.wYear,
               Now.wMonth, Now.wDay, Now.wHour, Now.wMinute, Now.wSecond, GetCurrentProcessId());
    Out = CreateFileW(PathOut, GENERIC_WRITE, FILE_SHARE_READ, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    OutLength = 0;
}

inline void CloseReport() noexcept
{
    Flush();
    if (Out != INVALID_HANDLE_VALUE) CloseHandle(Out);
    Out = INVALID_HANDLE_VALUE;
}

inline void WriteFull(Request& Request) noexcept
{
    wchar_t Path[MAX_PATH * 3]{};
    OpenReport(L"crash", Path, _countof(Path));
    SYSTEMTIME Now{};
    GetLocalTime(&Now);
    Put("Granite NBA 2K19 crash report\r\n");
    Put("Time:              %04u-%02u-%02u %02u:%02u:%02u.%03u local\r\n", Now.wYear, Now.wMonth, Now.wDay, Now.wHour,
        Now.wMinute, Now.wSecond, Now.wMilliseconds);
    Put("Process / thread:  %lu / %lu\r\n", GetCurrentProcessId(), Request.Thread);
    Put("Trigger:           %s\r\n", TriggerName(Request.Trigger));
    if (Request.Trigger == Trigger::TerminateProcess || Request.Trigger == Trigger::ExitProcess)
    {
        Put("Exit code:         0x%08X (%u) %s\r\n", Request.ExitCode, Request.ExitCode,
            ExceptionName(Request.ExitCode));
        PutAddressLine("Requested by:      ", Request.Caller);
        const ULONG_PTR Ida = Request.Caller - ExeBase + IdaImageBase;
        if (ExeBase && Request.Caller >= ExeBase && Ida >= GameFilterStart && Ida < GameFilterEnd)
            Put("                   (inside the game's TopLevelExceptionFilter: the game caught a crash and is ending the process)\r\n");
        if (AnyFatalSeen)
            Put("                   (last error-class first-chance exception %lu ms before this exit; see below)\r\n",
                GetTickCount() - static_cast<DWORD>(LastFatalTick));
    }
    if (Request.HasRecord) PutExceptionDetail(Request.Record);
    Flush();
    PutRegisters(Request.Context);
    PutStackFrames(Request.Context);
    Flush();
    PutAsserts();
    PutCloseMessages();
    PutRecentExceptions();
    Flush();
    PutStackScan(static_cast<ULONG_PTR>(Request.Context.Rsp));
    Flush();
    PutLogTail();
    PutEnvironment();
    PutModules();
    Flush();

    wchar_t DumpPath[MAX_PATH * 3]{};
    wcsncpy_s(DumpPath, Path, _TRUNCATE);
    if (wchar_t* Dot = wcsrchr(DumpPath, L'.'))
        wcscpy_s(Dot, _countof(DumpPath) - static_cast<size_t>(Dot - DumpPath), L".dmp");
    const HANDLE Dump = CreateFileW(DumpPath, GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (Dump != INVALID_HANDLE_VALUE)
    {
        MINIDUMP_EXCEPTION_INFORMATION Exception{};
        Exception.ThreadId = Request.Thread;
        Request.Pointers.ExceptionRecord = &Request.Record;
        Request.Pointers.ContextRecord = &Request.Context;
        Exception.ExceptionPointers = &Request.Pointers;
        Exception.ClientPointers = FALSE;
        const MINIDUMP_TYPE Type = static_cast<MINIDUMP_TYPE>(
            FullDump ? (MiniDumpWithFullMemory | MiniDumpWithHandleData | MiniDumpWithThreadInfo |
                        MiniDumpWithUnloadedModules | MiniDumpWithFullMemoryInfo)
                     : (MiniDumpWithDataSegs | MiniDumpWithHandleData | MiniDumpWithThreadInfo |
                        MiniDumpWithUnloadedModules | MiniDumpWithIndirectlyReferencedMemory |
                        MiniDumpWithProcessThreadData | MiniDumpWithFullMemoryInfo));
        const BOOL Written = MiniDumpWriteDump(GetCurrentProcess(), GetCurrentProcessId(), Dump, Type,
                                               Request.HasRecord ? &Exception : nullptr, nullptr, nullptr);
        const DWORD Error = Written ? 0 : GetLastError();
        CloseHandle(Dump);
        char DumpUtf8[MAX_PATH * 3];
        Utf8(DumpPath, -1, DumpUtf8, sizeof(DumpUtf8));
        Put("\r\n== Minidump ==\r\n  %s: %s (error %lu)%s\r\n", DumpUtf8, Written ? "written" : "FAILED", Error,
            FullDump ? " full memory" : "");
        Flush();
    }
    PutSymbols(Request.Context);
    Put("\r\n== End of report ==\r\n");
    CloseReport();
    wcsncpy_s(LastReportPath, Path, _TRUNCATE);
}

inline void WriteExit(Request& Request) noexcept
{
    wchar_t Path[MAX_PATH * 3]{};
    OpenReport(L"exit", Path, _countof(Path));
    SYSTEMTIME Now{};
    GetLocalTime(&Now);
    Put("Granite NBA 2K19 process exit record\r\n");
    Put("Time:              %04u-%02u-%02u %02u:%02u:%02u.%03u local\r\n", Now.wYear, Now.wMonth, Now.wDay, Now.wHour,
        Now.wMinute, Now.wSecond, Now.wMilliseconds);
    Put("Process / thread:  %lu / %lu\r\n", GetCurrentProcessId(), Request.Thread);
    Put("Trigger:           %s\r\n", TriggerName(Request.Trigger));
    Put("Exit code:         0x%08X (%u)\r\n", Request.ExitCode, Request.ExitCode);
    PutAddressLine("Requested by:      ", Request.Caller);
    Put("No error-class exception was seen in the preceding 60 seconds and the exit code is 0, so no minidump was written.\r\n");
    PutCloseMessages();
    PutStackFrames(Request.Context);
    PutAsserts();
    PutLogTail();
    Put("\r\n== End of record ==\r\n");
    CloseReport();
    wcsncpy_s(LastReportPath, Path, _TRUNCATE);
}

inline DWORD WINAPI WriterThread(void*)
{
    for (;;)
    {
        if (WaitForSingleObject(RequestEvent, INFINITE) != WAIT_OBJECT_0) return 0;
        if (Pending.Full)
            WriteFull(Pending);
        else
            WriteExit(Pending);
        SetEvent(DoneEvent);
    }
}

inline void Submit(Trigger Trigger, const EXCEPTION_RECORD* Record, const CONTEXT* Context, UINT ExitCode,
                   ULONG_PTR Caller, bool Full) noexcept
{
    if (!Installed || GetCurrentThreadId() == WriterThreadId) return;
    if (!RequestLock.TryLock())
    {
        if (DoneEvent) WaitForSingleObject(DoneEvent, 120000);
        return;
    }
    if (InterlockedCompareExchange(&CrashReportWritten, 1, 0) != 0) return;
    Pending.Trigger = Trigger;
    Pending.Full = Full;
    Pending.Thread = GetCurrentThreadId();
    Pending.ExitCode = ExitCode;
    Pending.Caller = Caller;
    Pending.HasRecord = Record != nullptr;
    if (Record) Pending.Record = *Record;
    if (Context) Pending.Context = *Context;
    if (WriterThreadId && RequestEvent && DoneEvent)
    {
        SetEvent(RequestEvent);
        WaitForSingleObject(DoneEvent, Full ? 180000 : 20000);
    }
    else if (Full)
        WriteFull(Pending);
    else
        WriteExit(Pending);
}

inline LPTOP_LEVEL_EXCEPTION_FILTER ChainedFilter = nullptr;
using SetFilterFn = LPTOP_LEVEL_EXCEPTION_FILTER(WINAPI*)(LPTOP_LEVEL_EXCEPTION_FILTER);
inline SetFilterFn SetFilterOriginal = nullptr;

inline LONG WINAPI UnhandledFilter(EXCEPTION_POINTERS* Info)
{
    if (Info && Info->ExceptionRecord && Info->ContextRecord)
        Submit(Trigger::Unhandled, Info->ExceptionRecord, Info->ContextRecord, 0, 0, true);
    const LPTOP_LEVEL_EXCEPTION_FILTER Chained = ChainedFilter;
    if (Chained && Chained != UnhandledFilter)
    {
        InterlockedExchange(&InsideGameFilter, 1);
        return Chained(Info);
    }
    return EXCEPTION_EXECUTE_HANDLER;
}

inline LPTOP_LEVEL_EXCEPTION_FILTER WINAPI SetFilterHook(LPTOP_LEVEL_EXCEPTION_FILTER Filter)
{
    if (Filter == UnhandledFilter) return SetFilterOriginal(Filter);
    const LPTOP_LEVEL_EXCEPTION_FILTER Previous = ChainedFilter;
    ChainedFilter = Filter;
    SetFilterOriginal(UnhandledFilter);
    wchar_t Line[640];
    char Where[512];
    Describe(reinterpret_cast<ULONG_PTR>(_ReturnAddress()), Where, sizeof(Where));
    char FilterWhere[512];
    Describe(reinterpret_cast<ULONG_PTR>(Filter), FilterWhere, sizeof(FilterWhere));
    swprintf_s(Line, L"[crash] SetUnhandledExceptionFilter(%S) from %S: chained behind the Granite recorder",
               FilterWhere, Where);
    Say(Line);
    return Previous;
}

inline void OnSelfExit(Trigger Trigger, UINT Code, ULONG_PTR Caller) noexcept
{
    CONTEXT Context{};
    RtlCaptureContext(&Context);
    const ULONG_PTR Ida = ExeBase && Caller >= ExeBase ? Caller - ExeBase + IdaImageBase : 0;
    const bool FromGameFilter = InsideGameFilter || (Ida >= GameFilterStart && Ida < GameFilterEnd);
    const bool RecentFatal = AnyFatalSeen && GetTickCount() - static_cast<DWORD>(LastFatalTick) < 60000;
    const bool Full = Code != 0 || FromGameFilter || RecentFatal;
    Submit(Trigger, nullptr, &Context, Code, Caller, Full);
}

using TerminateFn = BOOL(WINAPI*)(HANDLE, UINT);
inline TerminateFn TerminateOriginal = nullptr;
inline BOOL WINAPI TerminateHook(HANDLE Process, UINT Code)
{
    if (Process == GetCurrentProcess() || GetProcessId(Process) == GetCurrentProcessId())
        OnSelfExit(Trigger::TerminateProcess, Code, reinterpret_cast<ULONG_PTR>(_ReturnAddress()));
    return TerminateOriginal(Process, Code);
}

using ExitFn = void(NTAPI*)(LONG);
inline ExitFn ExitOriginal = nullptr;
inline void NTAPI ExitHook(LONG Code)
{
    OnSelfExit(Trigger::ExitProcess, static_cast<UINT>(Code), reinterpret_cast<ULONG_PTR>(_ReturnAddress()));
    ExitOriginal(Code);
}

using FailFastFn = void(WINAPI*)(PEXCEPTION_RECORD, PCONTEXT, DWORD);
inline FailFastFn FailFastOriginal = nullptr;
inline void WINAPI FailFastHook(PEXCEPTION_RECORD Record, PCONTEXT Context, DWORD Flags)
{
    CONTEXT Captured{};
    if (!Context) RtlCaptureContext(&Captured);
    EXCEPTION_RECORD Synthetic{};
    Synthetic.ExceptionCode = 0xC0000602;
    Synthetic.ExceptionAddress = _ReturnAddress();
    Submit(Trigger::FailFast, Record ? Record : &Synthetic, Context ? Context : &Captured, 0,
           reinterpret_cast<ULONG_PTR>(_ReturnAddress()), true);
    FailFastOriginal(Record, Context, Flags);
}

inline const char* HookApi(const wchar_t* Module, const char* Name, LPVOID Hook, LPVOID* Original) noexcept
{
    const HMODULE Handle = GetModuleHandleW(Module);
    const LPVOID Target = Handle ? reinterpret_cast<LPVOID>(GetProcAddress(Handle, Name)) : nullptr;
    if (!Target) return "missing";
    MH_STATUS Status = MH_CreateHook(Target, Hook, Original);
    if (Status == MH_OK) Status = MH_EnableHook(Target);
    return Status == MH_OK ? "ok" : "FAILED";
}

inline DWORD WINAPI MaintainerThread(void*)
{
    for (;;)
    {
        Sleep(3000);
        RefreshModules();
        if (!SetFilterOriginal)
        {
            const LPTOP_LEVEL_EXCEPTION_FILTER Previous = SetUnhandledExceptionFilter(UnhandledFilter);
            if (Previous && Previous != UnhandledFilter) ChainedFilter = Previous;
        }
    }
}

inline void StartWatcher() noexcept
{
    wchar_t Rundll[MAX_PATH]{};
    if (!GetSystemDirectoryW(Rundll, MAX_PATH)) return;
    wcscat_s(Rundll, L"\\rundll32.exe");
    wchar_t Command[MAX_PATH * 6]{};
    swprintf_s(Command, L"\"%s\" \"%s\",GraniteCrashWatch %lu \"%s\"", Rundll, SelfPath, GetCurrentProcessId(),
               SessionLogPath);
    STARTUPINFOW Startup{};
    Startup.cb = sizeof(Startup);
    PROCESS_INFORMATION Process{};
    BOOL Started = CreateProcessW(Rundll, Command, nullptr, nullptr, FALSE,
                                  CREATE_NO_WINDOW | CREATE_BREAKAWAY_FROM_JOB, nullptr, nullptr, &Startup, &Process);
    if (!Started)
        Started = CreateProcessW(Rundll, Command, nullptr, nullptr, FALSE, CREATE_NO_WINDOW, nullptr, nullptr, &Startup,
                                 &Process);
    wchar_t Line[128];
    if (Started)
    {
        swprintf_s(Line, L"[crash] exit watcher running as rundll32 pid %lu", Process.dwProcessId);
        CloseHandle(Process.hThread);
        CloseHandle(Process.hProcess);
    }
    else
    {
        swprintf_s(Line, L"[crash] exit watcher could not start (%lu); a __fastfail exit will leave no report",
                   GetLastError());
    }
    Say(Line);
}

inline bool FindReportFor(DWORD Pid, wchar_t* PathOut, size_t PathCount, bool& IsCrash) noexcept
{
    wchar_t Pattern[MAX_PATH * 3]{};
    swprintf_s(Pattern, L"%s\\granite-*-%lu.txt", Directory, Pid);
    WIN32_FIND_DATAW Data{};
    const HANDLE Find = FindFirstFileW(Pattern, &Data);
    if (Find == INVALID_HANDLE_VALUE) return false;
    bool Found = false;
    FILETIME Newest{};
    do {
        if (CompareFileTime(&Data.ftLastWriteTime, &Newest) >= 0)
        {
            Newest = Data.ftLastWriteTime;
            swprintf_s(PathOut, PathCount, L"%s\\%s", Directory, Data.cFileName);
            IsCrash = wcsncmp(Data.cFileName, L"granite-crash-", 14) == 0;
            Found = true;
        }
    } while (FindNextFileW(Find, &Data));
    FindClose(Find);
    return Found;
}

inline void AppendFileTail(const wchar_t* Path, DWORD MaxBytes) noexcept
{
    const HANDLE File = CreateFileW(Path, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr,
                                    OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (File == INVALID_HANDLE_VALUE)
    {
        Put("  (could not open, error %lu)\r\n", GetLastError());
        return;
    }
    LARGE_INTEGER Size{};
    GetFileSizeEx(File, &Size);
    LARGE_INTEGER Start{};
    Start.QuadPart = Size.QuadPart > MaxBytes ? Size.QuadPart - MaxBytes : 0;
    SetFilePointerEx(File, Start, nullptr, FILE_BEGIN);
    static char Buffer[1 << 16];
    DWORD Got = 0;
    Flush();
    while (ReadFile(File, Buffer, sizeof(Buffer), &Got, nullptr) && Got)
    {
        DWORD Wrote = 0;
        WriteFile(Out, Buffer, Got, &Wrote, nullptr);
    }
    CloseHandle(File);
}

inline void ListNewer(const wchar_t* Pattern, const FILETIME& Since) noexcept
{
    WIN32_FIND_DATAW Data{};
    const HANDLE Find = FindFirstFileW(Pattern, &Data);
    if (Find == INVALID_HANDLE_VALUE) return;
    do {
        if (CompareFileTime(&Data.ftLastWriteTime, &Since) >= 0)
        {
            char Name[MAX_PATH * 3];
            Utf8(Data.cFileName, -1, Name, sizeof(Name));
            char Where[MAX_PATH * 3];
            Utf8(Pattern, -1, Where, sizeof(Where));
            Put("  %s  (in %s)\r\n", Name, Where);
        }
    } while (FindNextFileW(Find, &Data));
    FindClose(Find);
}

inline void WatchMain(const wchar_t* CommandLine) noexcept
{
    if (!CommandLine) return;
    wchar_t* End = nullptr;
    const DWORD Pid = wcstoul(CommandLine, &End, 10);
    wchar_t LogPath[MAX_PATH * 2]{};
    if (End)
    {
        while (*End == L' ') ++End;
        if (*End == L'"') ++End;
        wcsncpy_s(LogPath, End, _TRUNCATE);
        if (wchar_t* Quote = wcsrchr(LogPath, L'"')) *Quote = 0;
    }
    GetModuleFileNameW(reinterpret_cast<HMODULE>(&__ImageBase), SelfPath, MAX_PATH * 2);
    wcsncpy_s(Directory, SelfPath, _TRUNCATE);
    if (wchar_t* Slash = wcsrchr(Directory, L'\\')) *Slash = 0;
    wcscat_s(Directory, L"\\console logs");

    const HANDLE Process = OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, FALSE, Pid);
    if (!Process) return;
    FILETIME Created{}, Exited{}, Kernel{}, User{};
    GetProcessTimes(Process, &Created, &Exited, &Kernel, &User);
    WaitForSingleObject(Process, INFINITE);
    DWORD Code = 0;
    GetExitCodeProcess(Process, &Code);
    GetProcessTimes(Process, &Created, &Exited, &Kernel, &User);
    CloseHandle(Process);
    Sleep(1500);

    SYSTEMTIME Now{};
    GetLocalTime(&Now);
    wchar_t Existing[MAX_PATH * 3]{};
    bool IsCrash = false;
    if (FindReportFor(Pid, Existing, _countof(Existing), IsCrash))
    {
        Out = CreateFileW(Existing, FILE_APPEND_DATA, FILE_SHARE_READ, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL,
                          nullptr);
        Put("\r\n== Exit watcher ==\r\n  process %lu ended at %02u:%02u:%02u with exit code 0x%08lX (%lu) %s\r\n", Pid,
            Now.wHour, Now.wMinute, Now.wSecond, Code, Code, ExceptionName(Code));
        CloseReport();
    }
    else
    {
        wchar_t Path[MAX_PATH * 3]{};
        swprintf_s(Path, L"%s\\granite-crash-%04u%02u%02u-%02u%02u%02u-%lu-external.txt", Directory, Now.wYear,
                   Now.wMonth, Now.wDay, Now.wHour, Now.wMinute, Now.wSecond, Pid);
        Out = CreateFileW(Path, GENERIC_WRITE, FILE_SHARE_READ, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
        Put("Granite NBA 2K19 external exit report (written by the watcher process)\r\n");
        Put("Process:           %lu\r\n", Pid);
        Put("Exit code:         0x%08lX (%lu) %s\r\n", Code, Code, ExceptionName(Code));
        Put("Meaning:           the game ended without passing through any Granite exception filter or exit hook.\r\n");
        if (Code == 0xC0000409)
            Put("                   0xC0000409 is a fail-fast (__fastfail): /GS stack cookie failure, CRT abort(), invalid CRT parameter,\r\n"
                "                   std::terminate, or corrupted exception chain. Fail-fast bypasses every in-process handler by design.\r\n");
        else if (Code == 0xC0000374)
            Put("                   0xC0000374 is heap corruption reported straight to the kernel.\r\n");
        else if (Code == 1)
            Put("                   exit code 1 is what Task Manager / taskkill / another process's TerminateProcess uses.\r\n");
        else if ((Code & 0xC0000000u) == 0xC0000000u)
            Put("                   an NTSTATUS exit code: the kernel ended the process for that status.\r\n");
        else
            Put("                   the exit path did not go through the hooked APIs (a direct NtTerminateProcess, or the Granite module was not loaded).\r\n");
        Put("\r\n== Crash artifacts newer than the process start ==\r\n");
        wchar_t Pattern[MAX_PATH * 3]{};
        wchar_t Base[MAX_PATH]{};
        if (GetEnvironmentVariableW(L"LOCALAPPDATA", Base, MAX_PATH))
        {
            swprintf_s(Pattern, L"%s\\CrashDumps\\NBA2K19*", Base);
            ListNewer(Pattern, Created);
        }
        if (GetEnvironmentVariableW(L"APPDATA", Base, MAX_PATH))
        {
            swprintf_s(Pattern, L"%s\\2K Sports\\NBA 2K19\\CrashReport*", Base);
            ListNewer(Pattern, Created);
        }
        if (GetEnvironmentVariableW(L"ProgramData", Base, MAX_PATH))
        {
            swprintf_s(Pattern, L"%s\\Microsoft\\Windows\\WER\\ReportArchive\\*NBA2K19*", Base);
            ListNewer(Pattern, Created);
            swprintf_s(Pattern, L"%s\\Microsoft\\Windows\\WER\\ReportQueue\\*NBA2K19*", Base);
            ListNewer(Pattern, Created);
        }
        if (LogPath[0])
        {
            char LogUtf8[MAX_PATH * 3];
            Utf8(LogPath, -1, LogUtf8, sizeof(LogUtf8));
            Put("\r\n== Tail of the session log %s ==\r\n", LogUtf8);
            AppendFileTail(LogPath, 48000);
        }
        Put("\r\n== End of report ==\r\n");
        CloseReport();
    }

    if (LogPath[0])
    {
        Out = CreateFileW(LogPath, FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING,
                          FILE_ATTRIBUTE_NORMAL, nullptr);
        Put("! [crash-watcher] process %lu exited with code 0x%08lX (%lu) %s\n", Pid, Code, Code, ExceptionName(Code));
        CloseReport();
    }
}

inline void Install(void (*InSink)(const wchar_t*), const wchar_t* InDirectory, const wchar_t* SessionLog,
                    HMODULE Self) noexcept
{
    if (InterlockedCompareExchange(&Installed, 1, 0) != 0) return;
    Sink = InSink;
    InstallTick = GetTickCount();
    wcsncpy_s(Directory, InDirectory, _TRUNCATE);
    CreateDirectoryW(Directory, nullptr);
    if (SessionLog) wcsncpy_s(SessionLogPath, SessionLog, _TRUNCATE);
    GetModuleFileNameW(Self, SelfPath, MAX_PATH * 2);
    wchar_t Flag[8]{};
    FullDump = GetEnvironmentVariableW(L"GRANITE_CRASH_FULLDUMP", Flag, 8) && Flag[0] == L'1';

    ExeBase = reinterpret_cast<ULONG_PTR>(GetModuleHandleW(nullptr));
    IMAGE_DOS_HEADER Dos{};
    IMAGE_NT_HEADERS64 Nt{};
    if (Read(&Dos, ExeBase, sizeof(Dos)) && Read(&Nt, ExeBase + static_cast<ULONG_PTR>(Dos.e_lfanew), sizeof(Nt)))
    {
        ExeSize = Nt.OptionalHeader.SizeOfImage;
        ExeTimeDateStamp = Nt.FileHeader.TimeDateStamp;
        VerifiedBuild =
            ExeTimeDateStamp == VerifiedTimeDateStamp && Nt.OptionalHeader.SizeOfImage == VerifiedSizeOfImage;
    }
    RefreshModules();

    RequestEvent = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    DoneEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    DWORD WriterId = 0;
    if (HANDLE Writer =
            CreateThread(nullptr, 1024 * 1024, WriterThread, nullptr, STACK_SIZE_PARAM_IS_A_RESERVATION, &WriterId))
    {
        WriterThreadId = WriterId;
        CloseHandle(Writer);
    }
    AddVectoredExceptionHandler(0, VectoredObserver);

    MH_Initialize();
    const char* SetFilter =
        HookApi(L"kernelbase.dll", "SetUnhandledExceptionFilter", reinterpret_cast<LPVOID>(&SetFilterHook),
                reinterpret_cast<LPVOID*>(&SetFilterOriginal));
    if (strcmp(SetFilter, "ok") != 0)
    {
        SetFilterOriginal = nullptr;
        SetFilter = HookApi(L"kernel32.dll", "SetUnhandledExceptionFilter", reinterpret_cast<LPVOID>(&SetFilterHook),
                            reinterpret_cast<LPVOID*>(&SetFilterOriginal));
        if (strcmp(SetFilter, "ok") != 0) SetFilterOriginal = nullptr;
    }
    const LPTOP_LEVEL_EXCEPTION_FILTER Previous =
        SetFilterOriginal ? SetFilterOriginal(UnhandledFilter) : SetUnhandledExceptionFilter(UnhandledFilter);
    if (Previous && Previous != UnhandledFilter) ChainedFilter = Previous;

    const char* TerminateStatus =
        HookApi(L"kernelbase.dll", "TerminateProcess", reinterpret_cast<LPVOID>(&TerminateHook),
                reinterpret_cast<LPVOID*>(&TerminateOriginal));
    const char* ExitStatus = HookApi(L"ntdll.dll", "RtlExitUserProcess", reinterpret_cast<LPVOID>(&ExitHook),
                                     reinterpret_cast<LPVOID*>(&ExitOriginal));
    const char* FailFastStatus =
        HookApi(L"kernelbase.dll", "RaiseFailFastException", reinterpret_cast<LPVOID>(&FailFastHook),
                reinterpret_cast<LPVOID*>(&FailFastOriginal));

    const char* AssertStatus = "skipped (unverified NBA2K19.exe build)";
    const char* WindowProc = "skipped (unverified NBA2K19.exe build)";
    if (VerifiedBuild)
    {
        const auto At = [](unsigned __int64 Va) { return reinterpret_cast<LPVOID>(ExeBase + (Va - IdaImageBase)); };
        unsigned char A[sizeof(AssertWrapperPrefix)]{}, B[sizeof(AssertWrapperPrefix)]{};
        const bool MatchA = Read(A, reinterpret_cast<ULONG_PTR>(At(AssertWrapperA)), sizeof(A)) &&
                            !memcmp(A, AssertWrapperPrefix, sizeof(A));
        const bool MatchB = Read(B, reinterpret_cast<ULONG_PTR>(At(AssertWrapperB)), sizeof(B)) &&
                            !memcmp(B, AssertWrapperPrefix, sizeof(B));
        bool OkA = false, OkB = false;
        if (MatchA && MH_CreateHook(At(AssertWrapperA), reinterpret_cast<LPVOID>(&AssertHookA),
                                    reinterpret_cast<LPVOID*>(&AssertOriginalA)) == MH_OK)
            OkA = MH_EnableHook(At(AssertWrapperA)) == MH_OK;
        if (MatchB && MH_CreateHook(At(AssertWrapperB), reinterpret_cast<LPVOID>(&AssertHookB),
                                    reinterpret_cast<LPVOID*>(&AssertOriginalB)) == MH_OK)
            OkB = MH_EnableHook(At(AssertWrapperB)) == MH_OK;
        AssertStatus = OkA && OkB ? "ok" : (MatchA && MatchB) ? "FAILED" : "skipped (entry bytes differ)";

        unsigned char W[sizeof(GameWindowProcPrefix)]{};
        const bool MatchW = Read(W, reinterpret_cast<ULONG_PTR>(At(GameWindowProc)), sizeof(W)) &&
                            !memcmp(W, GameWindowProcPrefix, sizeof(W));
        bool OkW = false;
        if (MatchW && MH_CreateHook(At(GameWindowProc), reinterpret_cast<LPVOID>(&WindowProcHook),
                                    reinterpret_cast<LPVOID*>(&WindowProcOriginal)) == MH_OK)
            OkW = MH_EnableHook(At(GameWindowProc)) == MH_OK;
        if (!OkW) WindowProcOriginal = nullptr;
        WindowProc = OkW ? "ok" : MatchW ? "FAILED" : "skipped (entry bytes differ)";
    }

    if (HANDLE Maintainer = CreateThread(nullptr, 0, MaintainerThread, nullptr, 0, nullptr)) CloseHandle(Maintainer);
    StartWatcher();

    wchar_t Line[900];
    swprintf_s(
        Line,
        L"[crash] recorder armed: writer thread %lu, first-chance observer, unhandled filter (chained: %s); "
        L"hooks SetUnhandledExceptionFilter=%S TerminateProcess=%S RtlExitUserProcess=%S RaiseFailFastException=%S "
        L"VCASSERT=%S window procedure close messages=%S; exe TimeDateStamp 0x%08lX %s; reports in %s",
        WriterThreadId, ChainedFilter ? L"yes" : L"none yet", SetFilter, TerminateStatus, ExitStatus, FailFastStatus,
        AssertStatus, WindowProc, ExeTimeDateStamp, VerifiedBuild ? L"(verified)" : L"(unverified)", Directory);
    Say(Line);
}

}
