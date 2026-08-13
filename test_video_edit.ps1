$token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJhZG1pbi1kZWZhdWx0IiwidXNlcm5hbWUiOiJhZG1pbiIsInJvbGUiOiJhZG1pbiIsImlhdCI6MTc4NjU4Mzg0NSwiZXhwIjoxNzg3MTg4NjQ1fQ.K4XwLHha00YeBFg1f9zZn0BbhyQDRpWGFml2YPwireo"
$testVideo = "d:\项目\aiDemo\aiProject\test_video.mp4"
$baseUrl = "http://localhost:3002"

function TestEndpoint($name, $method, $path, $body, $isMultiPart) {
    Write-Host "=== $name ==="
    try {
        $uri = "$baseUrl$path"
        if ($isMultiPart) {
            $boundary = [System.Guid]::NewGuid().ToString()
            $fileBytes = [System.IO.File]::ReadAllBytes($testVideo)
            $fileName = [System.IO.Path]::GetFileName($testVideo)
            
            $header = @"
--$boundary
Content-Disposition: form-data; name="video"; filename="$fileName"
Content-Type: video/mp4

"@
            $footer = @"

--$boundary--
"@
            $headerBytes = [System.Text.Encoding]::UTF8.GetBytes($header)
            $footerBytes = [System.Text.Encoding]::UTF8.GetBytes($footer)
            $bodyBytes = $headerBytes + $fileBytes + $footerBytes
            
            $req = [System.Net.HttpWebRequest]::Create($uri)
            $req.Method = $method
            $req.Headers.Add("Authorization", "Bearer $token")
            $req.ContentType = "multipart/form-data; boundary=$boundary"
            $req.Timeout = 10000
            $req.GetRequestStream().Write($bodyBytes, 0, $bodyBytes.Length)
            $req.GetRequestStream().Close()
            
            $resp = $req.GetResponse()
            $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
            $result = $reader.ReadToEnd()
            $reader.Close()
            $resp.Close()
            Write-Host "SUCCESS | Status: $($resp.StatusCode)"
            Write-Host $result
        } else {
            $req = [System.Net.HttpWebRequest]::Create($uri)
            $req.Method = $method
            $req.Headers.Add("Authorization", "Bearer $token")
            $req.ContentType = "application/json"
            $req.Timeout = 10000
            if ($body) {
                $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($body)
                $req.GetRequestStream().Write($bodyBytes, 0, $bodyBytes.Length)
                $req.GetRequestStream().Close()
            }
            $resp = $req.GetResponse()
            $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
            $result = $reader.ReadToEnd()
            $reader.Close()
            $resp.Close()
            Write-Host "SUCCESS | Status: $($resp.StatusCode)"
            Write-Host $result
        }
    } catch [System.Net.WebException] {
        $resp = $_.Exception.Response
        $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
        $result = $reader.ReadToEnd()
        $reader.Close()
        Write-Host "ERROR | Status: $($resp.StatusCode)"
        Write-Host $result
    } catch {
        Write-Host "EXCEPTION: $($_.Exception.Message)"
    }
}

# Test 8: Upload video
TestEndpoint "Test 8: POST /api/video-edit/upload" "POST" "/api/video-edit/upload" $null $true

# Test 9: Get tools
TestEndpoint "Test 9: GET /api/video-edit/tools" "GET" "/api/video-edit/tools" $null $false

# Test 10: Create task with real video
$taskBody = '{"videoPath":"d:\\项目\\aiDemo\\aiProject\\test_video.mp4","operations":["subtitle"],"params":{"subtitleLang":"zh","autoSubtitle":true}}'
TestEndpoint "Test 10: POST /api/video-edit/task" "POST" "/api/video-edit/task" $taskBody $false