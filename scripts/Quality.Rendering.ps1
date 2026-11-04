# Objectif : Préparer un suivi adaptatif et Unicode sans lancer de commande native.

function Get-QualityElements {
    <# .SYNOPSIS Mesure des graphèmes visibles en ignorant les séquences ANSI. .PARAMETER Text Texte à mesurer. #>
    param([AllowEmptyString()][string]$Text)
    $clean = $Text -replace '\x1b\][^\x07]*(?:\x07|\x1b\\)', '' -replace '\x1b\[[0-?]*[ -/]*[@-~]', '' -replace '[\r\n\t]', ' '
    $enumerator = [Globalization.StringInfo]::GetTextElementEnumerator($clean)
    while ($enumerator.MoveNext()) {
        $element = $enumerator.GetTextElement()
        $cells = 0
        for ($index=0; $index -lt $element.Length; $index++) {
            $code = [char]::ConvertToUtf32($element,$index)
            $category = [Globalization.CharUnicodeInfo]::GetUnicodeCategory($element,$index)
            if ([char]::IsHighSurrogate($element[$index])) { $index++ }
            if ($category -in @('NonSpacingMark','EnclosingMark','SpacingCombiningMark','Control','Format')) { continue }
            $wide = ($code -ge 0x1100 -and $code -le 0x115f) -or ($code -ge 0x2e80 -and $code -le 0xa4cf) -or ($code -ge 0xac00 -and $code -le 0xd7a3) -or ($code -ge 0xf900 -and $code -le 0xfaff) -or ($code -ge 0xfe10 -and $code -le 0xfe6f) -or ($code -ge 0xff01 -and $code -le 0xff60) -or ($code -ge 0xffe0 -and $code -le 0xffe6) -or ($code -ge 0x1f000 -and $code -le 0x1faff) -or ($code -ge 0x20000 -and $code -le 0x3fffd)
            $cells = [Math]::Max($cells, $(if ($wide) {2} else {1}))
        }
        if ($element.Contains([string][char]0xfe0f)) { $cells=[Math]::Max(2,$cells) }
        [pscustomobject]@{Text=$element;Width=$cells}
    }
}

function Get-QualityWidth {
    <# .SYNOPSIS Retourne la largeur de cellules d’un texte Unicode. .PARAMETER Text Texte visible. #>
    param([AllowEmptyString()][string]$Text)
    $width=0
    foreach($element in (Get-QualityElements $Text)) { $width += $element.Width }
    return $width
}

function Format-QualityCell {
    <# .SYNOPSIS Tronque explicitement un texte puis aligne ses cellules visibles. .PARAMETER Text Texte de cellule. .PARAMETER Width Largeur disponible. .PARAMETER Right Alignement numérique à droite. #>
    param([AllowNull()][object]$Text,[int]$Width,[switch]$Right)
    if($Width -le 0){return ''}
    $value=if($null -eq $Text){'-'}else{[string]$Text}
    $elements=@(Get-QualityElements $value)
    $visible=0; foreach($element in $elements){$visible+=$element.Width}
    $limit=if($visible -gt $Width){$Width-1}else{$Width}
    $builder=[Text.StringBuilder]::new();$used=0
    foreach($element in $elements){if($used+$element.Width -gt $limit){break};$null=$builder.Append($element.Text);$used+=$element.Width}
    if($visible -gt $Width){$null=$builder.Append('…');$used++}
    $padding=' '*[Math]::Max(0,$Width-$used)
    if($Right){return $padding+$builder.ToString()}
    return $builder.ToString()+$padding
}

function Format-QualityDuration {
    <# .SYNOPSIS Formate une durée observée en unités compactes. .PARAMETER Seconds Durée connue, ou null. #>
    param([AllowNull()][object]$Seconds)
    if($null -eq $Seconds){return '-'}
    $whole=[Math]::Max(0,[Math]::Floor([double]$Seconds))
    if($whole -lt 60){return "${whole}s"}
    $minutes=[Math]::Floor($whole/60);$remaining=$whole%60
    if($minutes -lt 60){return "${minutes}m"+$(if($remaining){"${remaining}s"}else{''})}
    $hours=[Math]::Floor($minutes/60);$minutes=$minutes%60
    return "${hours}h"+$(if($minutes){"${minutes}m"}else{''})
}

function Format-QualityTable {
    <# .SYNOPSIS Calcule une table selon la largeur courante, avec repli vertical pour les petits terminaux. .PARAMETER Rows Lancements observés. .PARAMETER Width Largeur disponible en cellules. #>
    param([object[]]$Rows=@(),[int]$Width=100)
    if($Width -lt 52){
        $inner=[Math]::Max(1,$Width-2)
        '┌'+('─'*$inner)+'┐'
        foreach($row in $Rows){
            foreach($text in @("$($row.Name) | $($row.State)","$($row.Platform) $($row.Identity)","Duration: $($row.Duration)","Pass: $($row.Passed) Fail: $($row.Failed)","Mut: $($row.Mutants) K:$($row.Killed) S:$($row.Survived)")){
                '|'+(Format-QualityCell $text $inner)+'|'
            }
        }
        '└'+('─'*$inner)+'┘'
        return
    }
    $columns=@('Name','Platform','State','Duration','Identity')
    $headers=@('Run','OS','State','Duration','Process')
    $widths=@(6,7,9,8,10)
    if($Width -ge 66){$columns+=@('Passed','Failed');$headers+=@('Pass','Fail');$widths+=@(6,6)}
    if($Width -ge 90){$columns+=@('Mutants','Killed','Survived');$headers+=@('Mut','Killed','Survive');$widths+=@(7,7,7)}
    $used=($widths|Measure-Object -Sum).Sum+$widths.Count+1
    if($used -lt $Width){$widths[0]+=[Math]::Min(8,$Width-$used)}
    $segments=@($widths|ForEach-Object{'─'*$_})
    '┌'+($segments -join '┬')+'┐'
    '|'+(@(for($i=0;$i -lt $columns.Count;$i++){Format-QualityCell $headers[$i] $widths[$i]}) -join '|')+'|'
    '├'+($segments -join '┼')+'┤'
    foreach($row in $Rows){
        '|'+(@(for($i=0;$i -lt $columns.Count;$i++){Format-QualityCell $row.($columns[$i]) $widths[$i] -Right:($i -ge 5 -or $columns[$i] -eq 'Duration')}) -join '|')+'|'
    }
    '└'+($segments -join '┴')+'┘'
}
