' Starts helper.py with no window. Put a shortcut to this file in your
' Startup folder (Win+R, shell:startup) to start it with Windows. If the helper
' is already running, the new one just exits (its port is taken).
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = here
On Error Resume Next
sh.Run "pyw """ & here & "\helper.py""", 0, False
If Err.Number <> 0 Then
  Err.Clear
  sh.Run "pythonw """ & here & "\helper.py""", 0, False
End If
