{{- define "kubebay.name" -}} {{ .Chart.Name }}-{{ .Release.Name }} {{- end -}}

{{/* Size of the volume the audit file lives on, in MiB. The file can take up to twice auditLog.maxSizeMiB (audit.log and the rotated audit.log.1), which must fit. */}}
{{- define "kubebay.auditVolumeMiB" -}}
{{- if .Values.auditLog.persistence.enabled -}}
  {{- if .Values.auditLog.persistence.existingClaim -}}0
  {{- else -}}
    {{- $s := .Values.auditLog.persistence.size | toString -}}
    {{- if hasSuffix "Ti" $s -}}{{ mul (trimSuffix "Ti" $s | int) 1048576 }}
    {{- else if hasSuffix "Gi" $s -}}{{ mul (trimSuffix "Gi" $s | int) 1024 }}
    {{- else if hasSuffix "Mi" $s -}}{{ trimSuffix "Mi" $s | int }}
    {{- else -}}{{ fail "auditLog.persistence.size must end in Mi, Gi or Ti" }}
    {{- end -}}
  {{- end -}}
{{- else -}}64{{- end -}}
{{- end -}}
