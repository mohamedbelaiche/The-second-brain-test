' ============================================
' العقل الثاني - مشغّل بدون نافذة CMD
' ============================================

Dim shell
Set shell = CreateObject("WScript.Shell")

' المسار الحالي لملف الـ VBS
Dim scriptDir
scriptDir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))

' تشغيل الـ batch بشكل خفي (بدون نافذة)
shell.Run """" & scriptDir & "start.bat""", 0, False

' رسالة ترحيبية
WScript.Sleep 2500
shell.Run "http://localhost:3000", 1, False

Set shell = Nothing
