# 安装 Windows 预览版

Tio 的 Windows 预览安装包由项目证书自签名。请从 [Tio GitHub Releases](https://github.com/glink25/tio/releases) 下载 `*-setup.exe`，从仓库下载 [Tio Windows 签名证书](../assets/tio-windows-signing.cer)，并将它们放在同一目录。

先运行 `Get-FileHash -Algorithm SHA256 <安装包文件名>`，与对应 Release 公布的安装包摘要核对。在 PowerShell 中将 `$installer` 改为实际的安装包文件名，再执行以下命令。证书文件和安装包内的签名证书都必须匹配项目公布的 SHA-256 指纹。`$signature.Status` 显示当前 Windows 对该签名的判断。

```powershell
$installer = '.\Tio_0.1.0-rc.11_x64-setup.exe'
$certificate = '.\tio-windows-signing.cer'
$expected = '57B0176FF6F7D51577F75D339A48D1A578E956427F45069D9E523F465264B085'

if ((Get-FileHash -Algorithm SHA256 $certificate).Hash -ne $expected) {
    throw 'Tio certificate fingerprint mismatch'
}

$signature = Get-AuthenticodeSignature -FilePath $installer
if (!$signature.SignerCertificate -or $signature.Status -eq 'HashMismatch') {
    throw 'Tio installer signature mismatch'
}
$sha256 = [System.Security.Cryptography.SHA256]::Create()
try {
    $signerHash = [BitConverter]::ToString(
        $sha256.ComputeHash($signature.SignerCertificate.RawData)
    ).Replace('-', '')
} finally {
    $sha256.Dispose()
}
if ($signerHash -ne $expected) {
    throw 'Tio installer signer mismatch'
}

Import-Certificate -FilePath $certificate -CertStoreLocation Cert:\CurrentUser\TrustedPeople
Get-AuthenticodeSignature -FilePath $installer
```

SmartScreen 和组织设备策略可能仍会提示或拦截，自签名证书只适用于明确选择信任该项目证书的用户。

移除信任时，从当前用户的「受信任的人」证书存储中删除 `Tio Project (glink25)`，先核对上面的 SHA-256 指纹。
