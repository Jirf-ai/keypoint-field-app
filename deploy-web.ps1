# Deploy the Field app web build (dist/) to the public `field-app` Supabase
# Storage bucket — the no-app-store distribution path (crews open the URL and
# Add to Home Screen). Run AFTER `npx expo export --platform web` + the
# index.html/sw.js patches (relative paths, PWA meta, service worker).
#
#   powershell -ExecutionPolicy Bypass -File deploy-web.ps1
#
# Needs the Supabase personal access token at
# C:\Users\Jeffrey\.claude\secrets\supabase-deploy-token (used once, to fetch
# the service key for the upload — nothing is printed).

$ErrorActionPreference = "Stop"
$proj = "bbkeogzyqwszmijmvlmj"
$dist = Join-Path $PSScriptRoot "dist"

# expo export rewrites dist/ from scratch — re-apply the PWA patches
# (relative paths, home-screen meta, sw.js offline shell) every deploy.
$env:Path = "C:\Program Files\nodejs;" + $env:Path
node (Join-Path $PSScriptRoot "scripts\patch-dist.js")

$tok = (Get-Content "C:\Users\Jeffrey\.claude\secrets\supabase-deploy-token" -Raw).Trim()
$keys = Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$proj/api-keys" -Headers @{ Authorization = "Bearer $tok" }
$svc = ($keys | Where-Object name -eq "service_role").api_key
if (-not $svc) { throw "could not fetch service_role key" }

# Bucket (public read; 409 = already exists, fine)
try {
    Invoke-RestMethod -Method Post -Uri "https://$proj.supabase.co/storage/v1/bucket" `
        -Headers @{ Authorization = "Bearer $svc" } -ContentType "application/json" `
        -Body '{"name":"field-app","id":"field-app","public":true}' | Out-Null
    Write-Host "bucket field-app created"
} catch { Write-Host "bucket field-app already exists" }

$mime = @{ ".html" = "text/html"; ".js" = "text/javascript"; ".ico" = "image/x-icon"; ".png" = "image/png"; ".json" = "application/json" }
Get-ChildItem $dist -Recurse -File | ForEach-Object {
    $key = $_.FullName.Substring($dist.Length + 1).Replace("\", "/")
    $ct = $mime[$_.Extension.ToLower()]
    if (-not $ct) { $ct = "application/octet-stream" }
    Invoke-RestMethod -Method Post -Uri "https://$proj.supabase.co/storage/v1/object/field-app/$key" `
        -Headers @{ Authorization = "Bearer $svc"; "x-upsert" = "true"; "cache-control" = "no-cache" } `
        -ContentType $ct -InFile $_.FullName | Out-Null
    Write-Host "uploaded $key ($ct)"
}

Write-Host ""
Write-Host "LIVE: https://$proj.supabase.co/storage/v1/object/public/field-app/index.html"
