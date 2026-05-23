$port = 8080
$file = "c:\Users\alexa\OneDrive\Desktop\Primus Systems\primus-v17 (1).html"

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)
$listener.Start()
Write-Host "Serving at http://localhost:$port/  (close this window to stop)" -ForegroundColor Cyan
Start-Process "http://localhost:$port/"

while ($true) {
    $client = $listener.AcceptTcpClient()
    $stream = $client.GetStream()
    try {
        # Read request (discard)
        $buf = New-Object byte[] 4096
        if ($stream.DataAvailable) { $stream.Read($buf, 0, $buf.Length) | Out-Null }

        $body    = [System.IO.File]::ReadAllBytes($file)
        $headers = [System.Text.Encoding]::ASCII.GetBytes(
            "HTTP/1.1 200 OK`r`nContent-Type: text/html; charset=utf-8`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n"
        )
        $stream.Write($headers, 0, $headers.Length)
        $stream.Write($body,    0, $body.Length)
    } catch { }
    try { $stream.Close(); $client.Close() } catch { }
}
