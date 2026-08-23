{{- define "kubebay.name" -}} {{ .Chart.Name }}-{{ .Release.Name }} {{- end -}}
