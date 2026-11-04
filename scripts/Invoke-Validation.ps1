# Objectif : Valider Result.Ts en arrière-plan avec une fenêtre PowerShell de suivi et des preuves conservées.
<#
.SYNOPSIS Compile et vérifie le paquet Result du workspace pnpm.
.PARAMETER Phase Tests avec couverture et distribution, ou campagne de mutation.
.PARAMETER RunDirectory Dossier absolu des journaux, états et résultats.
.PARAMETER Worker Exécution interne du processus de fond.
#>
[CmdletBinding()]
param(
    [ValidateSet('Tests','Mutation')][string]$Phase='Tests',
    [string]$RunDirectory,
    [switch]$Worker
)
$ErrorActionPreference='Stop'
$utf8=[Text.UTF8Encoding]::new($false)
[Console]::InputEncoding=$utf8
[Console]::OutputEncoding=$utf8
$OutputEncoding=$utf8
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$project=Join-Path $root 'packages/Result.Ts'
$workspace=[IO.Path]::GetFullPath((Join-Path $root '../../..'))
if(!$RunDirectory){$RunDirectory=Join-Path $root ('test-results/'+$Phase.ToLowerInvariant()+'-'+(Get-Date -Format 'yyyyMMdd-HHmmss-fff'))}
$RunDirectory=[IO.Path]::GetFullPath($RunDirectory)
$null=New-Item -ItemType Directory -Path $RunDirectory -Force
if(!$Worker){
    $shell=(Get-Process -Id $PID).Path
    $job=Start-Process $shell -WindowStyle Hidden -PassThru -ArgumentList @('-NoProfile','-File',('"'+$PSCommandPath+'"'),'-Worker','-Phase',$Phase,'-RunDirectory',('"'+$RunDirectory+'"')) -RedirectStandardOutput (Join-Path $RunDirectory 'worker.log') -RedirectStandardError (Join-Path $RunDirectory 'worker-errors.log')
    $watcher=Join-Path $PSScriptRoot 'Watch-Quality.ps1'
    $monitor=Start-Process $shell -WindowStyle Normal -PassThru -ArgumentList @('-NoProfile','-File',('"'+$watcher+'"'),'-RunDirectory',('"'+$RunDirectory+'"'),'-WorkerId',$job.Id)
    Write-Output "Suivi : pwsh -NoProfile -File `"$watcher`" -RunDirectory `"$RunDirectory`" -WorkerId $($job.Id)"
    $null=$job.WaitForExitAsync().GetAwaiter().GetResult()
    $null=$monitor.WaitForExitAsync().GetAwaiter().GetResult()
    Write-Output "Bilan : $(Join-Path $RunDirectory 'summary.json')"
    exit $job.ExitCode
}
$state=@{Project=$project;Workspace=$workspace;Targets=@('Result.Ts');WorkerId=$PID;State='Running';Runs=@();Saved=$false;Scope=$Phase}
function Save-ValidationState {
    <# .SYNOPSIS Sauvegarde un état UTF-8 par remplacement atomique. #>
    $file=Join-Path $RunDirectory 'quality.json'
    $null=[IO.File]::WriteAllTextAsync(($file+'.new'),($state|ConvertTo-Json -Depth 12),$utf8).GetAwaiter().GetResult()
    Move-Item -LiteralPath ($file+'.new') -Destination $file -Force
}
function Invoke-ValidationStep {
    <#
    .SYNOPSIS Exécute un outil documenté via pump et sauvegarde son résultat.
    .PARAMETER Name Nom de l'étape visible dans le suivi.
    .PARAMETER Arguments Arguments du point d'entrée Node local.
    .PARAMETER Timeout Délai maximal de cette étape en secondes.
    #>
    param([string]$Name,[string[]]$Arguments,[int]$Timeout=600)
    $entry=@{Name=$Name;Platform='Windows';State='Running';Started=[DateTimeOffset]::UtcNow.ToString('O');Duration=$null;Identity="worker:$PID";Passed=$null;Failed=$null;Lines=0}
    $state.Runs+=,$entry
    Save-ValidationState
    $writer=[IO.StreamWriter]::new((Join-Path $RunDirectory ($Name+'.log')),$false,$utf8)
    try{
        $progress=@{Entry=$entry;Writer=$writer;Diagnostics=[Collections.Generic.List[string]]::new()}
        # Objectif : Exécuter l'étape sélectionnée et garder des diagnostics bornés dans la réponse.
        $result=pump -AsObject -WorkingDirectory $project -TimeoutSeconds $Timeout -State $progress -OnOutput {
            param($record,$p)
            $p.Entry.Lines++
            $null=$p.Writer.WriteLineAsync($record.Text).GetAwaiter().GetResult()
            $null=$p.Writer.FlushAsync().GetAwaiter().GetResult()
            foreach($line in ($record.Text -split '\r?\n')){if($p.Diagnostics.Count -lt 12){$p.Diagnostics.Add($line)}}
            if($p.Entry.Identity -like 'worker:*'){
                $child=Get-CimInstance Win32_Process -Filter "ParentProcessId=$PID" -ErrorAction SilentlyContinue|Where-Object Name -eq 'node.exe'|Select-Object -First 1
                if($child){$p.Entry.Identity="node:$($child.ProcessId)"}
            }
            Save-ValidationState
        } -Complete {param($p,$capture) @{Diagnostics=@($p.Diagnostics);Lines=$p.Entry.Lines}} node @Arguments
        $entry.ExitCode=$result.Execution.ExitCode
        $entry.State=if($result.Outcome -eq 'Timeout'){'Timeout'}elseif($result.Outcome -eq 'Success' -and $result.Completeness.Source -and $result.Completeness.Analysis){'Success'}elseif($null -eq $result.Execution.ExitCode){'Crash'}else{'Failed'}
        $entry.Duration=([DateTimeOffset]::UtcNow-[DateTimeOffset]::Parse($entry.Started)).TotalSeconds
        $null=[IO.File]::WriteAllTextAsync((Join-Path $RunDirectory ($Name+'.result.json')),($result|ConvertTo-QuietJson -MaxOutputBytes 4000),$utf8).GetAwaiter().GetResult()
        $reportPath=Join-Path $RunDirectory 'tests.json'
        if($Name -eq 'Tests' -and (Test-Path -LiteralPath $reportPath)){
            $report=Get-Content -LiteralPath $reportPath -Raw -Encoding utf8|ConvertFrom-Json
            $entry.Passed=$report.numPassedTests
            $entry.Failed=$report.numFailedTests
            if(!$report.success){$entry.State='Failed'}
        }
        $mutationPath=Join-Path $RunDirectory 'mutation/mutation-report.json'
        if($Name -eq 'Mutation' -and (Test-Path -LiteralPath $mutationPath)){
            $report=Get-Content -LiteralPath $mutationPath -Raw -Encoding utf8|ConvertFrom-Json
            $mutants=@($report.files.PSObject.Properties|ForEach-Object {$_.Value.mutants})
            $entry.Mutants=$mutants.Count
            foreach($status in @('Killed','Survived','NoCoverage','Timeout','CompileError','RuntimeError','Ignored')){
                $entry[$status]=@($mutants|Where-Object status -eq $status).Count
            }
        }
        Save-ValidationState
        if($entry.State -ne 'Success'){throw "$Name : $($entry.State). Voir $(Join-Path $RunDirectory ($Name+'.log'))"}
    }finally{$null=$writer.DisposeAsync().AsTask().GetAwaiter().GetResult()}
}
try{
    Save-ValidationState
    Import-Module (Join-Path $workspace 'PoSh/FrenchExDev/QuietCliEcosystem/FrenchExDev.QuietCli.PoSh/FrenchExDev.QuietCli.PoSh.psd1') -DisableNameChecking
    $tsc=Join-Path $project 'node_modules/typescript/bin/tsc'
    Invoke-ValidationStep -Name 'Build' -Arguments @($tsc,'-p','tsconfig.json')
    Invoke-ValidationStep -Name 'Types' -Arguments @($tsc,'-p','test/tsconfig.json','--noEmit')
    if($Phase -eq 'Tests'){
        Invoke-ValidationStep -Name 'Tests' -Arguments @((Join-Path $project 'node_modules/vitest/vitest.mjs'),'run','--coverage','--reporter=default','--reporter=json',('--outputFile='+(Join-Path $RunDirectory 'tests.json')),('--coverage.reportsDirectory='+(Join-Path $RunDirectory 'coverage')))
        # Objectif : Préparer une archive avec pnpm puis vérifier l'import ESM hors du workspace.
        $pnpm=Join-Path $env:APPDATA 'npm/node_modules/pnpm/bin/pnpm.mjs'
        Invoke-ValidationStep -Name 'Pack' -Arguments @($pnpm,'pack','--config.ignore-scripts=true','--pack-destination',$RunDirectory)
        $tarball=Join-Path $RunDirectory 'frenchexdev2-result-0.1.0.tgz'
        $extracted=Join-Path $RunDirectory 'distribution'
        $null=New-Item -ItemType Directory -Path $extracted
        $inputFile=[IO.FileStream]::new($tarball,[IO.FileMode]::Open,[IO.FileAccess]::Read)
        $gzip=[IO.Compression.GZipStream]::new($inputFile,[IO.Compression.CompressionMode]::Decompress)
        try{$null=[System.Formats.Tar.TarFile]::ExtractToDirectoryAsync($gzip,$extracted,$false).GetAwaiter().GetResult()}finally{$null=$gzip.DisposeAsync().AsTask().GetAwaiter().GetResult()}
        Invoke-ValidationStep -Name 'ESM' -Arguments @((Join-Path $project 'test/integration/packed-package.mjs'),(Join-Path $extracted 'package'))
    }else{
        $env:STRYKER_REPORT_DIR=(Join-Path $RunDirectory 'mutation').Replace('\','/')
        Invoke-ValidationStep -Name 'Mutation' -Arguments @((Join-Path $project 'node_modules/@stryker-mutator/core/bin/stryker.js'),'run') -Timeout 10800
    }
    $state.State='Success'
}catch{
    $state.State='Failed'
    $state.Error=$_.Exception.Message
    foreach($run in $state.Runs){if($run.State -eq 'Running'){$run.State='Crash';$run.Duration=([DateTimeOffset]::UtcNow-[DateTimeOffset]::Parse($run.Started)).TotalSeconds}}
}finally{
    $state.Saved=$true
    $null=[IO.File]::WriteAllTextAsync((Join-Path $RunDirectory 'summary.json'),($state|ConvertTo-Json -Depth 12),$utf8).GetAwaiter().GetResult()
    Save-ValidationState
}
if($state.State -ne 'Success'){exit 1}
