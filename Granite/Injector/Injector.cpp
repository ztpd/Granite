// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0A00
#endif

#include <windows.h>
#include <tlhelp32.h>

#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <cwctype>
#include <filesystem>
#include <fstream>
#include <limits>
#include <sstream>
#include <string>
#include <vector>

namespace fs = std::filesystem;

namespace
{
constexpr wchar_t TargetExecutableName[] = L"NBA2K19.exe";
constexpr wchar_t ModuleName[] = L"Module.dll";
constexpr DWORD InitialLoadWaitMs = 30'000;

enum class ExitCode : int
{
    Success = 0,
    UsageError = 20,
    ValidationError = 21,
    ProcessAccessError = 22,
    ModuleInspectionError = 23,
    InjectionError = 24,
    UnexpectedError = 25,
};

enum class LogLevel
{
    Info,
    Verbose,
    Error,
};

class UniqueHandle
{
public:
    UniqueHandle() noexcept = default;
    explicit UniqueHandle(HANDLE InHandle) noexcept : Handle(InHandle) {}

    ~UniqueHandle() { Reset(); }

    UniqueHandle(const UniqueHandle&) = delete;
    UniqueHandle& operator=(const UniqueHandle&) = delete;

    UniqueHandle(UniqueHandle&& Other) noexcept : Handle(Other.Release()) {}

    UniqueHandle& operator=(UniqueHandle&& Other) noexcept
    {
        if (this != &Other)
        {
            Reset(Other.Release());
        }
        return *this;
    }

    [[nodiscard]] bool Valid() const noexcept { return Handle != nullptr && Handle != INVALID_HANDLE_VALUE; }

    [[nodiscard]] HANDLE Get() const noexcept { return Handle; }

    HANDLE Release() noexcept
    {
        HANDLE Released = Handle;
        Handle = nullptr;
        return Released;
    }

    void Reset(HANDLE Replacement = nullptr) noexcept
    {
        if (Valid())
        {
            CloseHandle(Handle);
        }
        Handle = Replacement;
    }

private:
    HANDLE Handle = nullptr;
};

class RemoteAllocation
{
public:
    RemoteAllocation(HANDLE InProcess, void* InAddress) noexcept : Process(InProcess), Address(InAddress) {}

    ~RemoteAllocation()
    {
        if (Address != nullptr)
        {
            VirtualFreeEx(Process, Address, 0, MEM_RELEASE);
        }
    }

    RemoteAllocation(const RemoteAllocation&) = delete;
    RemoteAllocation& operator=(const RemoteAllocation&) = delete;

    [[nodiscard]] void* Get() const noexcept { return Address; }

    bool FreeNow(DWORD& Error) noexcept
    {
        if (Address == nullptr)
        {
            Error = ERROR_SUCCESS;
            return true;
        }
        if (!VirtualFreeEx(Process, Address, 0, MEM_RELEASE))
        {
            Error = GetLastError();
            return false;
        }
        Address = nullptr;
        Error = ERROR_SUCCESS;
        return true;
    }

private:
    HANDLE Process = nullptr;
    void* Address = nullptr;
};

void Log(LogLevel Level, const std::wstring& Message)
{
    const bool IsError = Level == LogLevel::Error;
    FILE* Stream = IsError ? stderr : stdout;
    HANDLE Output = GetStdHandle(IsError ? STD_ERROR_HANDLE : STD_OUTPUT_HANDLE);

    const wchar_t* Label = L"INFO";
    WORD Color = FOREGROUND_GREEN | FOREGROUND_INTENSITY;
    if (Level == LogLevel::Verbose)
    {
        Label = L"VERBOSE";
        Color = FOREGROUND_RED | FOREGROUND_GREEN | FOREGROUND_INTENSITY;
    }
    else if (Level == LogLevel::Error)
    {
        Label = L"ERROR";
        Color = FOREGROUND_RED | FOREGROUND_INTENSITY;
    }

    CONSOLE_SCREEN_BUFFER_INFO Original{};
    const bool HasConsole =
        Output != nullptr && Output != INVALID_HANDLE_VALUE && GetConsoleScreenBufferInfo(Output, &Original) != FALSE;
    if (HasConsole)
    {
        SetConsoleTextAttribute(Output, Color);
    }

    std::fwprintf(Stream, L"[%ls] %ls\n", Label, Message.c_str());
    std::fflush(Stream);

    if (HasConsole)
    {
        SetConsoleTextAttribute(Output, Original.wAttributes);
    }
}

std::wstring DescribeWindowsError(DWORD Error)
{
    wchar_t* RawMessage = nullptr;
    const DWORD Count =
        FormatMessageW(FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
                       nullptr, Error, 0, reinterpret_cast<wchar_t*>(&RawMessage), 0, nullptr);

    std::wstring Message;
    if (Count != 0 && RawMessage != nullptr)
    {
        Message.assign(RawMessage, Count);
        LocalFree(RawMessage);
        while (!Message.empty() && std::iswspace(Message.back()) != 0)
        {
            Message.pop_back();
        }
    }

    std::wostringstream Result;
    Result << L"Windows error " << Error;
    if (!Message.empty())
    {
        Result << L": " << Message;
    }
    return Result.str();
}

bool DecodeUtf8(const std::string& Bytes, std::wstring& Decoded)
{
    if (Bytes.empty())
    {
        Decoded.clear();
        return true;
    }
    if (Bytes.size() > static_cast<std::size_t>(std::numeric_limits<int>::max()))
    {
        return false;
    }

    const int SourceLength = static_cast<int>(Bytes.size());
    const int Required = MultiByteToWideChar(CP_UTF8, 0, Bytes.data(), SourceLength, nullptr, 0);
    if (Required <= 0)
    {
        return false;
    }

    Decoded.resize(static_cast<std::size_t>(Required));
    return MultiByteToWideChar(CP_UTF8, 0, Bytes.data(), SourceLength, Decoded.data(), Required) == Required;
}

bool EqualOrdinalIgnoreCase(const std::wstring& Left, const std::wstring& Right)
{
    if (Left.size() > static_cast<std::size_t>(std::numeric_limits<int>::max()) ||
        Right.size() > static_cast<std::size_t>(std::numeric_limits<int>::max()))
    {
        return false;
    }

    return CompareStringOrdinal(Left.data(), static_cast<int>(Left.size()), Right.data(),
                                static_cast<int>(Right.size()), TRUE) == CSTR_EQUAL;
}

bool GetLoadedModulePath(HMODULE Module, fs::path& Path, DWORD& Error)
{
    std::vector<wchar_t> Buffer(512);
    while (Buffer.size() <= 32'768)
    {
        SetLastError(ERROR_SUCCESS);
        const DWORD Length = GetModuleFileNameW(Module, Buffer.data(), static_cast<DWORD>(Buffer.size()));
        if (Length == 0)
        {
            Error = GetLastError();
            return false;
        }
        if (Length < Buffer.size())
        {
            Path = fs::path(std::wstring(Buffer.data(), Length));
            Error = ERROR_SUCCESS;
            return true;
        }
        Buffer.resize(Buffer.size() * 2);
    }

    Error = ERROR_BUFFER_OVERFLOW;
    return false;
}

bool ParseProcessId(const wchar_t* Text, DWORD& ProcessId)
{
    if (Text == nullptr || *Text == L'\0')
    {
        return false;
    }

    std::uint64_t Value = 0;
    for (const wchar_t* Cursor = Text; *Cursor != L'\0'; ++Cursor)
    {
        if (*Cursor < L'0' || *Cursor > L'9')
        {
            return false;
        }
        const unsigned int Digit = static_cast<unsigned int>(*Cursor - L'0');
        if (Value > (std::numeric_limits<DWORD>::max() - Digit) / 10ULL)
        {
            return false;
        }
        Value = Value * 10ULL + Digit;
    }

    if (Value == 0)
    {
        return false;
    }
    ProcessId = static_cast<DWORD>(Value);
    return true;
}

bool IsRegularFile(const fs::path& Path)
{
    std::error_code Error;
    return fs::is_regular_file(Path, Error) && !Error;
}

bool ReadExactly(HANDLE File, void* Destination, DWORD ByteCount, DWORD& Error)
{
    DWORD BytesRead = 0;
    if (!ReadFile(File, Destination, ByteCount, &BytesRead, nullptr))
    {
        Error = GetLastError();
        return false;
    }
    if (BytesRead != ByteCount)
    {
        Error = ERROR_BAD_FORMAT;
        return false;
    }
    Error = ERROR_SUCCESS;
    return true;
}

bool ReadPeArchitecture(const fs::path& Path, WORD& Machine, bool& IsDll, DWORD& Error)
{
    UniqueHandle File(CreateFileW(Path.c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_DELETE, nullptr,
                                  OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr));
    if (!File.Valid())
    {
        Error = GetLastError();
        return false;
    }

    LARGE_INTEGER FileSize{};
    if (!GetFileSizeEx(File.Get(), &FileSize))
    {
        Error = GetLastError();
        return false;
    }
    if (FileSize.QuadPart < static_cast<LONGLONG>(sizeof(IMAGE_DOS_HEADER)))
    {
        Error = ERROR_BAD_FORMAT;
        return false;
    }

    IMAGE_DOS_HEADER DosHeader{};
    if (!ReadExactly(File.Get(), &DosHeader, sizeof(DosHeader), Error) || DosHeader.e_magic != IMAGE_DOS_SIGNATURE ||
        DosHeader.e_lfanew < 0)
    {
        Error = ERROR_BAD_FORMAT;
        return false;
    }

    constexpr LONGLONG RequiredHeaderBytes =
        static_cast<LONGLONG>(sizeof(DWORD) + sizeof(IMAGE_FILE_HEADER) + sizeof(WORD));
    if (static_cast<LONGLONG>(DosHeader.e_lfanew) > FileSize.QuadPart - RequiredHeaderBytes)
    {
        Error = ERROR_BAD_FORMAT;
        return false;
    }

    LARGE_INTEGER NtOffset{};
    NtOffset.QuadPart = DosHeader.e_lfanew;
    if (!SetFilePointerEx(File.Get(), NtOffset, nullptr, FILE_BEGIN))
    {
        Error = GetLastError();
        return false;
    }

    DWORD Signature = 0;
    IMAGE_FILE_HEADER FileHeader{};
    WORD OptionalMagic = 0;
    if (!ReadExactly(File.Get(), &Signature, sizeof(Signature), Error) ||
        !ReadExactly(File.Get(), &FileHeader, sizeof(FileHeader), Error) ||
        !ReadExactly(File.Get(), &OptionalMagic, sizeof(OptionalMagic), Error))
    {
        return false;
    }
    if (Signature != IMAGE_NT_SIGNATURE || FileHeader.SizeOfOptionalHeader < sizeof(OptionalMagic))
    {
        Error = ERROR_BAD_FORMAT;
        return false;
    }

    Machine = FileHeader.Machine;
    IsDll = (FileHeader.Characteristics & IMAGE_FILE_DLL) != 0;
    if (Machine == IMAGE_FILE_MACHINE_AMD64 && OptionalMagic != IMAGE_NT_OPTIONAL_HDR64_MAGIC)
    {
        Error = ERROR_BAD_FORMAT;
        return false;
    }

    Error = ERROR_SUCCESS;
    return true;
}

bool QueryProcessImagePath(HANDLE Process, fs::path& ImagePath, DWORD& Error)
{
    std::vector<wchar_t> Buffer(512);
    while (Buffer.size() <= 32'768)
    {
        DWORD Length = static_cast<DWORD>(Buffer.size());
        if (QueryFullProcessImageNameW(Process, 0, Buffer.data(), &Length))
        {
            ImagePath = fs::path(std::wstring(Buffer.data(), Length));
            Error = ERROR_SUCCESS;
            return true;
        }

        Error = GetLastError();
        if (Error != ERROR_INSUFFICIENT_BUFFER)
        {
            return false;
        }
        Buffer.resize(Buffer.size() * 2);
    }

    Error = ERROR_BUFFER_OVERFLOW;
    return false;
}

using IsWow64Process2Function = BOOL(WINAPI*)(HANDLE, USHORT*, USHORT*);

bool QueryEffectiveMachine(HANDLE Process, USHORT& EffectiveMachine, DWORD& Error)
{
    const HMODULE Kernel32 = GetModuleHandleW(L"kernel32.dll");
    if (Kernel32 == nullptr)
    {
        Error = GetLastError();
        return false;
    }

    const auto IsWow64Process2 = reinterpret_cast<IsWow64Process2Function>(GetProcAddress(Kernel32, "IsWow64Process2"));
    if (IsWow64Process2 != nullptr)
    {
        USHORT ProcessMachine = IMAGE_FILE_MACHINE_UNKNOWN;
        USHORT NativeMachine = IMAGE_FILE_MACHINE_UNKNOWN;
        if (!IsWow64Process2(Process, &ProcessMachine, &NativeMachine))
        {
            Error = GetLastError();
            return false;
        }
        EffectiveMachine = ProcessMachine == IMAGE_FILE_MACHINE_UNKNOWN ? NativeMachine : ProcessMachine;
        Error = ERROR_SUCCESS;
        return true;
    }

    BOOL IsWow64 = FALSE;
    if (!IsWow64Process(Process, &IsWow64))
    {
        Error = GetLastError();
        return false;
    }
    if (IsWow64)
    {
        EffectiveMachine = IMAGE_FILE_MACHINE_I386;
        Error = ERROR_SUCCESS;
        return true;
    }

    SYSTEM_INFO SystemInfo{};
    GetNativeSystemInfo(&SystemInfo);
    if (SystemInfo.wProcessorArchitecture == PROCESSOR_ARCHITECTURE_AMD64)
    {
        EffectiveMachine = IMAGE_FILE_MACHINE_AMD64;
        Error = ERROR_SUCCESS;
        return true;
    }

    Error = ERROR_NOT_SUPPORTED;
    return false;
}

struct RemoteModule
{
    std::uintptr_t Base = 0;
    DWORD Size = 0;
    std::wstring Name;
    std::wstring Path;
};

bool EnumerateRemoteModules(DWORD ProcessId, std::vector<RemoteModule>& Modules, DWORD& Error)
{
    Modules.clear();
    for (int Attempt = 0; Attempt < 8; ++Attempt)
    {
        UniqueHandle Snapshot(CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, ProcessId));
        if (!Snapshot.Valid())
        {
            Error = GetLastError();
            if (Error == ERROR_BAD_LENGTH)
            {
                Sleep(10);
                continue;
            }
            return false;
        }

        MODULEENTRY32W Entry{};
        Entry.dwSize = sizeof(Entry);
        if (!Module32FirstW(Snapshot.Get(), &Entry))
        {
            Error = GetLastError();
            if (Error == ERROR_BAD_LENGTH)
            {
                Sleep(10);
                continue;
            }
            return false;
        }

        do {
            Modules.push_back(RemoteModule{
                reinterpret_cast<std::uintptr_t>(Entry.modBaseAddr),
                Entry.modBaseSize,
                Entry.szModule,
                Entry.szExePath,
            });
            Entry.dwSize = sizeof(Entry);
        } while (Module32NextW(Snapshot.Get(), &Entry));

        const DWORD EnumerationError = GetLastError();
        if (EnumerationError != ERROR_NO_MORE_FILES)
        {
            Modules.clear();
            Error = EnumerationError;
            return false;
        }

        Error = ERROR_SUCCESS;
        return true;
    }

    Error = ERROR_BAD_LENGTH;
    return false;
}

std::wstring NormalizePathForComparison(const fs::path& Path)
{
    return Path.lexically_normal().wstring();
}

const RemoteModule* FindRemoteModule(const std::vector<RemoteModule>& Modules, const std::wstring& Name)
{
    const auto Match = std::find_if(Modules.begin(), Modules.end(), [&Name](const RemoteModule& Module)
                                    { return EqualOrdinalIgnoreCase(Module.Name, Name); });
    return Match == Modules.end() ? nullptr : &*Match;
}

bool ResolveRemoteLoadLibraryW(const std::vector<RemoteModule>& Modules, LPTHREAD_START_ROUTINE& RemoteFunction,
                               std::wstring& OwnerName, DWORD& Error)
{
    const HMODULE Kernel32 = GetModuleHandleW(L"kernel32.dll");
    if (Kernel32 == nullptr)
    {
        Error = GetLastError();
        return false;
    }

    const FARPROC LocalLoadLibrary = GetProcAddress(Kernel32, "LoadLibraryW");
    if (LocalLoadLibrary == nullptr)
    {
        Error = GetLastError();
        return false;
    }

    MEMORY_BASIC_INFORMATION MemoryInformation{};
    if (VirtualQuery(reinterpret_cast<const void*>(LocalLoadLibrary), &MemoryInformation, sizeof(MemoryInformation)) ==
            0 ||
        MemoryInformation.AllocationBase == nullptr)
    {
        Error = GetLastError();
        return false;
    }

    const auto LocalOwner = reinterpret_cast<HMODULE>(MemoryInformation.AllocationBase);
    fs::path LocalOwnerPath;
    if (!GetLoadedModulePath(LocalOwner, LocalOwnerPath, Error))
    {
        return false;
    }
    OwnerName = LocalOwnerPath.filename().wstring();

    const RemoteModule* RemoteOwner = FindRemoteModule(Modules, OwnerName);
    if (RemoteOwner == nullptr)
    {
        Error = ERROR_MOD_NOT_FOUND;
        return false;
    }

    const std::uintptr_t LocalOwnerBase = reinterpret_cast<std::uintptr_t>(LocalOwner);
    const std::uintptr_t LocalFunctionAddress = reinterpret_cast<std::uintptr_t>(LocalLoadLibrary);
    if (LocalFunctionAddress < LocalOwnerBase)
    {
        Error = ERROR_INVALID_ADDRESS;
        return false;
    }

    const std::uintptr_t RelativeAddress = LocalFunctionAddress - LocalOwnerBase;
    if (RelativeAddress >= RemoteOwner->Size ||
        RemoteOwner->Base > std::numeric_limits<std::uintptr_t>::max() - RelativeAddress)
    {
        Error = ERROR_INVALID_ADDRESS;
        return false;
    }

    RemoteFunction = reinterpret_cast<LPTHREAD_START_ROUTINE>(RemoteOwner->Base + RelativeAddress);
    Error = ERROR_SUCCESS;
    return true;
}

std::wstring FormatAddress(const void* Address)
{
    std::wostringstream Stream;
    Stream << L"0x" << std::hex << std::uppercase << reinterpret_cast<std::uintptr_t>(Address);
    return Stream.str();
}
}

int wmain(int argc, wchar_t* argv[])
{
#ifndef _WIN64
    Log(LogLevel::Error, L"Injector must be built for x64.");
    return static_cast<int>(ExitCode::ValidationError);
#endif

    try
    {
        if (argc != 2)
        {
            Log(LogLevel::Error, L"Usage: Injector.exe <NBA2K19 process ID>");
            return static_cast<int>(ExitCode::UsageError);
        }

        DWORD ProcessId = 0;
        if (!ParseProcessId(argv[1], ProcessId))
        {
            Log(LogLevel::Error, L"Process ID must contain only decimal digits and fit in a nonzero DWORD.");
            return static_cast<int>(ExitCode::UsageError);
        }

        DWORD Error = ERROR_SUCCESS;
        fs::path InjectorPath;
        if (!GetLoadedModulePath(nullptr, InjectorPath, Error))
        {
            Log(LogLevel::Error, L"Could not resolve Injector.exe path: " + DescribeWindowsError(Error));
            return static_cast<int>(ExitCode::ValidationError);
        }

        const fs::path ModulePath = (InjectorPath.parent_path() / ModuleName).lexically_normal();
        if (!IsRegularFile(ModulePath))
        {
            Log(LogLevel::Error, L"Missing Module.dll beside Injector.exe: " + ModulePath.wstring());
            return static_cast<int>(ExitCode::ValidationError);
        }

        WORD ModuleMachine = IMAGE_FILE_MACHINE_UNKNOWN;
        bool ModuleIsDll = false;
        if (!ReadPeArchitecture(ModulePath, ModuleMachine, ModuleIsDll, Error))
        {
            Log(LogLevel::Error, L"Could not validate Module.dll: " + DescribeWindowsError(Error));
            return static_cast<int>(ExitCode::ValidationError);
        }
        if (!ModuleIsDll || ModuleMachine != IMAGE_FILE_MACHINE_AMD64)
        {
            Log(LogLevel::Error, L"Module.dll must be a valid x64 Windows DLL.");
            return static_cast<int>(ExitCode::ValidationError);
        }

        constexpr DWORD ProcessAccess = PROCESS_CREATE_THREAD | PROCESS_QUERY_INFORMATION | PROCESS_VM_OPERATION |
                                        PROCESS_VM_WRITE | PROCESS_VM_READ | SYNCHRONIZE;
        UniqueHandle Process(OpenProcess(ProcessAccess, FALSE, ProcessId));
        if (!Process.Valid())
        {
            Log(LogLevel::Error, L"Could not open target PID " + std::to_wstring(ProcessId) + L": " +
                                     DescribeWindowsError(GetLastError()));
            return static_cast<int>(ExitCode::ProcessAccessError);
        }

        const DWORD TargetState = WaitForSingleObject(Process.Get(), 0);
        if (TargetState == WAIT_OBJECT_0)
        {
            Log(LogLevel::Error, L"Target process has already exited.");
            return static_cast<int>(ExitCode::ValidationError);
        }
        if (TargetState == WAIT_FAILED)
        {
            Log(LogLevel::Error, L"Could not query target process state: " + DescribeWindowsError(GetLastError()));
            return static_cast<int>(ExitCode::ProcessAccessError);
        }

        fs::path TargetImagePath;
        if (!QueryProcessImagePath(Process.Get(), TargetImagePath, Error))
        {
            Log(LogLevel::Error, L"Could not identify target process: " + DescribeWindowsError(Error));
            return static_cast<int>(ExitCode::ProcessAccessError);
        }
        if (!EqualOrdinalIgnoreCase(TargetImagePath.filename().wstring(), TargetExecutableName))
        {
            Log(LogLevel::Error,
                L"PID " + std::to_wstring(ProcessId) + L" is not NBA2K19.exe: " + TargetImagePath.wstring());
            return static_cast<int>(ExitCode::ValidationError);
        }

        USHORT TargetMachine = IMAGE_FILE_MACHINE_UNKNOWN;
        if (!QueryEffectiveMachine(Process.Get(), TargetMachine, Error))
        {
            Log(LogLevel::Error, L"Could not determine target architecture: " + DescribeWindowsError(Error));
            return static_cast<int>(ExitCode::ValidationError);
        }
        if (TargetMachine != IMAGE_FILE_MACHINE_AMD64)
        {
            std::wostringstream Message;
            Message << L"NBA2K19 target is not x64 (machine 0x" << std::hex << std::uppercase << TargetMachine << L").";
            Log(LogLevel::Error, Message.str());
            return static_cast<int>(ExitCode::ValidationError);
        }

        Log(LogLevel::Info, L"Validated NBA2K19 PID " + std::to_wstring(ProcessId) + L" as x64.");
        Log(LogLevel::Verbose, L"Target image: " + TargetImagePath.wstring());
        Log(LogLevel::Verbose, L"Module path: " + ModulePath.wstring());

        std::vector<RemoteModule> Modules;
        if (!EnumerateRemoteModules(ProcessId, Modules, Error))
        {
            Log(LogLevel::Error, L"Could not enumerate target modules: " + DescribeWindowsError(Error));
            return static_cast<int>(ExitCode::ModuleInspectionError);
        }

        const std::wstring RequestedModulePath = NormalizePathForComparison(ModulePath);
        for (const RemoteModule& Module : Modules)
        {
            if (!EqualOrdinalIgnoreCase(Module.Name, ModuleName))
            {
                continue;
            }

            const std::wstring LoadedPath = NormalizePathForComparison(fs::path(Module.Path));
            if (EqualOrdinalIgnoreCase(LoadedPath, RequestedModulePath))
            {
                Log(LogLevel::Info, L"Module.dll is already loaded from the requested path.");
                return static_cast<int>(ExitCode::Success);
            }

            Log(LogLevel::Error, L"A different Module.dll is already loaded: " + Module.Path);
            return static_cast<int>(ExitCode::ValidationError);
        }

        LPTHREAD_START_ROUTINE RemoteLoadLibraryW = nullptr;
        std::wstring LoaderOwner;
        if (!ResolveRemoteLoadLibraryW(Modules, RemoteLoadLibraryW, LoaderOwner, Error))
        {
            Log(LogLevel::Error, L"Could not resolve LoadLibraryW in the target: " + DescribeWindowsError(Error));
            return static_cast<int>(ExitCode::ModuleInspectionError);
        }
        Log(LogLevel::Verbose, L"Resolved remote LoadLibraryW through " + LoaderOwner + L" at " +
                                   FormatAddress(reinterpret_cast<const void*>(RemoteLoadLibraryW)) + L".");

        const std::wstring ModulePathText = ModulePath.wstring();
        if (ModulePathText.size() >= (std::numeric_limits<SIZE_T>::max() / sizeof(wchar_t)) - 1)
        {
            Log(LogLevel::Error, L"Module path is too long to allocate safely.");
            return static_cast<int>(ExitCode::ValidationError);
        }
        const SIZE_T ModulePathBytes = (ModulePathText.size() + 1) * sizeof(wchar_t);

        void* RemotePath =
            VirtualAllocEx(Process.Get(), nullptr, ModulePathBytes, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
        if (RemotePath == nullptr)
        {
            Log(LogLevel::Error, L"Could not allocate target memory: " + DescribeWindowsError(GetLastError()));
            return static_cast<int>(ExitCode::InjectionError);
        }
        RemoteAllocation Allocation(Process.Get(), RemotePath);
        Log(LogLevel::Verbose, L"Allocated remote path buffer at " + FormatAddress(RemotePath) + L".");

        SIZE_T BytesWritten = 0;
        if (!WriteProcessMemory(Process.Get(), RemotePath, ModulePathText.c_str(), ModulePathBytes, &BytesWritten) ||
            BytesWritten != ModulePathBytes)
        {
            const DWORD WriteError = GetLastError();
            Log(LogLevel::Error,
                L"Could not write the complete Module.dll path: " +
                    DescribeWindowsError(WriteError == ERROR_SUCCESS ? ERROR_WRITE_FAULT : WriteError));
            return static_cast<int>(ExitCode::InjectionError);
        }

        UniqueHandle RemoteThread(
            CreateRemoteThread(Process.Get(), nullptr, 0, RemoteLoadLibraryW, RemotePath, 0, nullptr));
        if (!RemoteThread.Valid())
        {
            Log(LogLevel::Error,
                L"Could not create the target LoadLibraryW thread: " + DescribeWindowsError(GetLastError()));
            return static_cast<int>(ExitCode::InjectionError);
        }

        Log(LogLevel::Info, L"Started remote LoadLibraryW; waiting for Module.dll initialization.");
        DWORD LoadWait = WaitForSingleObject(RemoteThread.Get(), InitialLoadWaitMs);
        if (LoadWait == WAIT_TIMEOUT)
        {
            Log(LogLevel::Verbose,
                L"Module.dll initialization is taking longer than 30 seconds; continuing to wait for safe cleanup.");
            LoadWait = WaitForSingleObject(RemoteThread.Get(), INFINITE);
        }
        if (LoadWait != WAIT_OBJECT_0)
        {
            Log(LogLevel::Error,
                L"Waiting for remote LoadLibraryW failed: " +
                    DescribeWindowsError(LoadWait == WAIT_FAILED ? GetLastError() : ERROR_GEN_FAILURE));
            return static_cast<int>(ExitCode::InjectionError);
        }

        DWORD LoadResult = 0;
        const bool ReadLoadResult = GetExitCodeThread(RemoteThread.Get(), &LoadResult) != FALSE;

        DWORD FreeError = ERROR_SUCCESS;
        const bool MemoryFreed = Allocation.FreeNow(FreeError);
        if (!MemoryFreed)
        {
            Log(LogLevel::Error, L"Module loaded, but remote path cleanup failed: " + DescribeWindowsError(FreeError));
            return static_cast<int>(ExitCode::InjectionError);
        }
        Log(LogLevel::Verbose, L"Freed the remote path buffer.");

        if (!ReadLoadResult)
        {
            Log(LogLevel::Error, L"Could not read the LoadLibraryW result: " + DescribeWindowsError(GetLastError()));
            return static_cast<int>(ExitCode::InjectionError);
        }
        if (LoadResult == 0)
        {
            Log(LogLevel::Error, L"LoadLibraryW returned null; Module.dll was not loaded.");
            return static_cast<int>(ExitCode::InjectionError);
        }

        Log(LogLevel::Info, L"Module.dll loaded successfully in NBA2K19.");
        return static_cast<int>(ExitCode::Success);
    }
    catch (const std::exception& Exception)
    {
        std::wstring Message;
        if (!DecodeUtf8(Exception.what(), Message))
        {
            Message = L"Unspecified C++ exception.";
        }
        Log(LogLevel::Error, L"Unexpected injector failure: " + Message);
        return static_cast<int>(ExitCode::UnexpectedError);
    }
    catch (...)
    {
        Log(LogLevel::Error, L"Unexpected injector failure.");
        return static_cast<int>(ExitCode::UnexpectedError);
    }
}
