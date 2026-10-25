$ErrorActionPreference = "Stop"
$pluginRoot = $PSScriptRoot
$source = [IO.File]::ReadAllText((Join-Path $pluginRoot "src/steve_previewer.js"))
$geometry = Get-Content -Raw -LiteralPath (Join-Path $pluginRoot "assets/steve.geo.json") | ConvertFrom-Json
$geometryJson = ConvertTo-Json -InputObject $geometry.'minecraft:geometry'[0] -Depth 40 -Compress
$textureBytes = [IO.File]::ReadAllBytes((Join-Path $pluginRoot "assets/steve.png"))
$textureJson = '"data:image/png;base64,' + [Convert]::ToBase64String($textureBytes) + '"'
$source = $source.Replace('/* @embedded-steve-geometry */ null', $geometryJson)
$source = $source.Replace('/* @embedded-steve-texture */ ""', $textureJson)
$output = Join-Path $pluginRoot "dist/steve_previewer.js"
[IO.Directory]::CreateDirectory((Split-Path $output)) | Out-Null
[IO.File]::WriteAllText($output, $source, [Text.UTF8Encoding]::new($false))
Write-Output $output
