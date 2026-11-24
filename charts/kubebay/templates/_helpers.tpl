{{- define "kubebay.name" -}} {{ .Chart.Name }}-{{ .Release.Name }} {{- end -}}

{{/* Size of the volume the audit file lives on, in MiB. The file can take up to twice auditLog.maxSizeMiB (audit.log and the rotated audit.log.1), which must fit. */}}
{{- define "kubebay.auditVolumeMiB" -}}
{{- if .Values.auditLog.persistence.enabled -}}
  {{- if .Values.auditLog.persistence.existingClaim -}}0
  {{- else -}}
    {{- $s := .Values.auditLog.persistence.size | toString -}}
    {{- if not (regexMatch "^[0-9]+(Mi|Gi|Ti)$" $s) }}{{ fail "auditLog.persistence.size must be a whole number ending in Mi, Gi or Ti (for example 1Gi)" }}{{ end -}}
    {{- if hasSuffix "Ti" $s -}}{{ mul (trimSuffix "Ti" $s | int) 1048576 }}
    {{- else if hasSuffix "Gi" $s -}}{{ mul (trimSuffix "Gi" $s | int) 1024 }}
    {{- else if hasSuffix "Mi" $s -}}{{ trimSuffix "Mi" $s | int }}
    {{- else -}}{{ fail "auditLog.persistence.size must end in Mi, Gi or Ti" }}
    {{- end -}}
  {{- end -}}
{{- else -}}64{{- end -}}
{{- end -}}

{{/* "true" when the engine learns who a user is from OIDC or from an auth proxy, else empty. Refuses a setup the engine would refuse to start with. */}}
{{- define "kubebay.sharedIdentity" -}}
{{- if and .Values.oidc.issuerUrl .Values.authProxy.enabled }}{{ fail "oidc.issuerUrl and authProxy.enabled are both set; the engine takes sign-in from one or the other, never both" }}{{ end -}}
{{- if .Values.authProxy.enabled -}}
  {{- if not .Values.authProxy.userHeader }}{{ fail "authProxy.userHeader is required when authProxy.enabled is true" }}{{ end -}}
  {{- if and (not .Values.authProxy.trustedCIDRs) (not .Values.authProxy.allowAnyPeer) }}{{ fail "authProxy.trustedCIDRs is required: list the address range your proxy connects from (or set authProxy.allowAnyPeer to trust every peer, which is unsafe)" }}{{ end -}}
  {{- range .Values.authProxy.trustedCIDRs -}}
    {{- if and (or (hasSuffix "/0" .) (not (contains "/" .))) (not $.Values.authProxy.allowAnyPeer) }}{{ fail (printf "authProxy.trustedCIDRs entry %q trusts every peer or is not a CIDR; set authProxy.allowAnyPeer to acknowledge that" .) }}{{ end -}}
  {{- end -}}
  {{- if and .Values.authProxy.secret.header (not .Values.authProxy.secret.existingSecret) }}{{ fail "authProxy.secret.header needs authProxy.secret.existingSecret, the name of a Secret holding the shared secret" }}{{ end -}}
  {{- if and .Values.authProxy.secret.existingSecret (not .Values.authProxy.secret.header) }}{{ fail "authProxy.secret.existingSecret needs authProxy.secret.header, the header the proxy sends it in" }}{{ end -}}
true
{{- else if .Values.oidc.issuerUrl -}}
true
{{- end -}}
{{- end -}}
