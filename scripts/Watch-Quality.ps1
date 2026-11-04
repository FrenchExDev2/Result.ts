# Objectif : Suivre les tests et mutants de Result.Ts avec redimensionnement et fermeture automatique.
<# .SYNOPSIS Lit uniquement les preuves du lancement choisi. .PARAMETER RunDirectory Répertoire des états et journaux. .PARAMETER WorkerId Processus propriétaire de la campagne. #>
param([Parameter(Mandatory)][string]$RunDirectory,[Parameter(Mandatory)][int]$WorkerId,[string[]]$AdditionalRunDirectories=@())
$utf8=[Text.UTF8Encoding]::new($false)
[Console]::InputEncoding=$utf8
[Console]::OutputEncoding=$utf8
$OutputEncoding=$utf8
. (Join-Path $PSScriptRoot 'Quality.Rendering.ps1')
$interactive=![Console]::IsOutputRedirected
$Host.UI.RawUI.WindowTitle='Projet : Result.Ts | Tâche : validation du workspace pnpm'
$cursor=$true
try{
    if($interactive){$cursor=[Console]::CursorVisible;[Console]::CursorVisible=$false}
    while($true){
        $state=$null
        try{
            $file=[IO.FileStream]::new((Join-Path $RunDirectory 'quality.json'),[IO.FileMode]::Open,[IO.FileAccess]::Read,([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
            $reader=[IO.StreamReader]::new($file,$utf8)
            try{$state=$reader.ReadToEndAsync().GetAwaiter().GetResult()|ConvertFrom-Json -DateKind String}finally{$reader.Dispose()}
        }catch{}
        if(!$state){
            if(!$interactive -or !(Get-Process -Id $WorkerId -ErrorAction SilentlyContinue)){
                [Console]::WriteLine('Projet : Result.Ts | Tâche : validation du workspace pnpm | État indisponible')
                [Console]::WriteLine([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../..')))
                break
            }
            [Threading.Tasks.Task]::Delay(250).GetAwaiter().GetResult()|Out-Null;continue
        }
        $workerIds=@($WorkerId)
        if($AdditionalRunDirectories.Count){
            $states=@($state)
            foreach($directory in $AdditionalRunDirectories){
                try{
                    $extraFile=[IO.FileStream]::new((Join-Path $directory 'quality.json'),[IO.FileMode]::Open,[IO.FileAccess]::Read,([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
                    $extraReader=[IO.StreamReader]::new($extraFile,$utf8)
                    try{$extra=$extraReader.ReadToEndAsync().GetAwaiter().GetResult()|ConvertFrom-Json -DateKind String}finally{$extraReader.Dispose()}
                    $states+=,$extra
                    $workerIds+=$extra.WorkerId
                }catch{$states+=,[pscustomobject]@{State='Running';Saved=$false;Runs=@();Error='Lecture du suivi supplémentaire en attente.'}}
            }
            $combinedState=if(@($states|Where-Object State -eq 'Running').Count){'Running'}elseif(@($states|Where-Object State -ne 'Success').Count){'Failed'}else{'Success'}
            $state=[pscustomobject]@{Runs=@($states.Runs);Workspace=$state.Workspace;Project=$state.Project;State=$combinedState;Saved=(@($states|Where-Object {!$_.Saved}).Count -eq 0);Error=(@($states.Error|Where-Object {$_}) -join ' | ')}
        }
        $width=if($interactive){[Math]::Max(8,[Console]::WindowWidth-1)}else{100}
        $height=if($interactive){[Math]::Max(4,[Console]::WindowHeight-1)}else{100}
        $rows=@(foreach($run in $state.Runs){
            $elapsed=if($run.State -eq 'Running'){([DateTimeOffset]::UtcNow-[DateTimeOffset]::Parse($run.Started)).TotalSeconds}else{$run.Duration}
            [pscustomobject]@{Name=$run.Name;Platform=($run.Platform ?? 'Windows');State=$run.State;Duration=Format-QualityDuration $elapsed;Identity=$run.Identity;Passed=$run.Passed;Failed=$run.Failed;Mutants=$run.Mutants;Killed=$run.Killed;Survived=$run.Survived}
        })
        $lines=[Collections.Generic.List[string]]::new()
        $lines.Add('Projet : Result.Ts | Tâche : validation du workspace pnpm')
        $lines.Add($state.Workspace)
        $lines.Add("Projet : $($state.Project)")
        $lines.AddRange([string[]](Format-QualityTable -Rows $rows -Width $width))
        $active=$state.Runs|Where-Object State -eq 'Running'|Select-Object -First 1
        if($active){
            $log=Join-Path $RunDirectory ($active.Name+'.log')
            $bytes=if(Test-Path $log){(Get-Item $log).Length}else{0}
            $lines.Add("Heartbeat : $bytes octets | $(Format-QualityDuration (([DateTimeOffset]::UtcNow-[DateTimeOffset]::Parse($active.Started)).TotalSeconds))")
        }
        $lines.Add("État : $($state.State) | Rapports : $RunDirectory")
        if($state.Error){$lines.Add($state.Error)}
        $alive=@($workerIds|Where-Object {Get-Process -Id $_ -ErrorAction SilentlyContinue}).Count -gt 0
        if(!$alive -and $state.State -eq 'Running'){$lines.Add('Crash : worker terminé avant le bilan final.')}
        # La largeur et la hauteur sont relues à chaque rafraîchissement, sans dépendre des données.
        $visible=@($lines|Select-Object -First $height|ForEach-Object{Format-QualityCell $_ $width})
        if($interactive){
            $escape=[char]27
            $frame="${escape}[H"+(($visible|ForEach-Object{"${escape}[2K`r$_`r`n"})-join '')
            [Console]::Write($frame+"${escape}[J")
        }else{[Console]::WriteLine(($visible -join [Environment]::NewLine))}
        if(($state.State -ne 'Running' -and $state.Saved) -or !$alive -or !$interactive){break}
        [Threading.Tasks.Task]::Delay(500).GetAwaiter().GetResult()|Out-Null
    }
}finally{if($interactive){[Console]::CursorVisible=$cursor}}
