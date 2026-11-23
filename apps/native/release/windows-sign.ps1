$ErrorActionPreference = 'Stop'
$path = Join-Path $env:RUNNER_TEMP 'tio-signing.pfx'
[IO.File]::WriteAllBytes($path, [Convert]::FromBase64String($env:WINDOWS_CERTIFICATE_BASE64))
try {
  $password = ConvertTo-SecureString $env:WINDOWS_CERTIFICATE_PASSWORD -AsPlainText -Force
  $certificate = Import-PfxCertificate -FilePath $path -CertStoreLocation Cert:\CurrentUser\My -Password $password
  if ($certificate.GetCertHashString([Security.Cryptography.HashAlgorithmName]::SHA256) -ne $env:WINDOWS_CERTIFICATE_SHA256) { throw 'Unexpected signing certificate' }
  @{bundle=@{windows=@{certificateThumbprint=$certificate.Thumbprint;digestAlgorithm='sha256';timestampUrl='https://timestamp.digicert.com'}}} | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $env:RUNNER_TEMP 'tio-windows-sign.json')
  "TIO_WINDOWS_THUMBPRINT=$($certificate.Thumbprint)" >> $env:GITHUB_ENV
} finally {
  Remove-Item $path -ErrorAction SilentlyContinue
}
