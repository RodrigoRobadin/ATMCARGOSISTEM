@echo off
setlocal EnableExtensions

echo =====================================
echo Generando APK Release ATMCARGOSISTEM
echo =====================================

set "SOURCE_DIR=%~dp0"
set "SOURCE_DIR=%SOURCE_DIR:~0,-1%"
set "BUILD_ROOT=%USERPROFILE%\m%TIME:~0,2%%TIME:~3,2%%TIME:~6,2%"
set "BUILD_ROOT=%BUILD_ROOT: =0%"
set "APK_DEST=%SOURCE_DIR%\android\app\build\outputs\apk\release\app-release.apk"

set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
set "ANDROID_SDK_ROOT=%ANDROID_HOME%"
set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"
set "PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\platform-tools;%ANDROID_HOME%\emulator;%ANDROID_HOME%\cmdline-tools\latest\bin;%PATH%"
set "EXPO_PUBLIC_API_URL=https://atmcargosoft.com/api"
set "EXPO_NO_TELEMETRY=1"
set "ATM_NDK_VERSION=30.0.14904198"

echo.
echo Verificando herramientas...
if not exist "%JAVA_HOME%\bin\java.exe" (
    echo No se encontro Java en: %JAVA_HOME%
    pause
    exit /b 1
)

if not exist "%ANDROID_HOME%\platform-tools\adb.exe" (
    echo No se encontro adb en: %ANDROID_HOME%\platform-tools
    pause
    exit /b 1
)

if not exist "%ANDROID_HOME%\ndk\%ATM_NDK_VERSION%\source.properties" (
    echo No se encontro NDK completo en: %ANDROID_HOME%\ndk\%ATM_NDK_VERSION%
    echo Instala NDK Side by side %ATM_NDK_VERSION% desde Android Studio.
    pause
    exit /b 1
)

echo.
echo Copiando proyecto mobile a ruta corta:
echo %BUILD_ROOT%
if exist "%BUILD_ROOT%" rmdir /s /q "%BUILD_ROOT%"
mkdir "%BUILD_ROOT%"
robocopy "%SOURCE_DIR%" "%BUILD_ROOT%" /E /XD "%SOURCE_DIR%\android" "%SOURCE_DIR%\.expo" /NFL /NDL /NJH /NJS /NP
if errorlevel 8 (
    echo.
    echo Error copiando proyecto mobile.
    pause
    exit /b 1
)

cd /d "%BUILD_ROOT%"

echo.
echo Ejecutando Expo prebuild...
call npx expo prebuild -p android --no-install
if errorlevel 1 (
    echo.
    echo Error en expo prebuild.
    pause
    exit /b 1
)

echo.
echo Fijando NDK local compatible...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$root='android/build.gradle'; $app='android/app/build.gradle'; $ndk=$env:ATM_NDK_VERSION; " ^
  "$rootText=Get-Content $root -Raw; " ^
  "if ($rootText -notmatch 'rootProject\.ext\.ndkVersion') { $rootText=$rootText -replace '(buildscript\s*\{)', ('$1' + [Environment]::NewLine + '    rootProject.ext.ndkVersion = ''' + $ndk + ''''); Set-Content $root $rootText -NoNewline } " ^
  "$appText=Get-Content $app -Raw; " ^
  "$appText=$appText -replace 'ndkVersion rootProject\.ext\.ndkVersion', ('ndkVersion \"' + $ndk + '\"'); " ^
  "Set-Content $app $appText -NoNewline"
if errorlevel 1 (
    echo.
    echo Error fijando NDK en Gradle.
    pause
    exit /b 1
)

echo.
echo Compilando APK Release...
cd /d "%BUILD_ROOT%\android"
call gradlew.bat assembleRelease --parallel --build-cache --daemon --stacktrace -x lint -x test --no-configuration-cache --quiet
if errorlevel 1 (
    echo.
    echo Error al compilar APK.
    pause
    exit /b 1
)

echo.
echo Copiando APK al proyecto original...
if not exist "%SOURCE_DIR%\android\app\build\outputs\apk\release" mkdir "%SOURCE_DIR%\android\app\build\outputs\apk\release"
copy /Y "%BUILD_ROOT%\android\app\build\outputs\apk\release\app-release.apk" "%APK_DEST%"
if errorlevel 1 (
    echo.
    echo APK generado pero no se pudo copiar al proyecto original.
    echo Buscar en: %BUILD_ROOT%\android\app\build\outputs\apk\release
    pause
    exit /b 1
)

echo.
echo APK generado correctamente:
echo %APK_DEST%
echo.
explorer "%SOURCE_DIR%\android\app\build\outputs\apk\release"

pause
