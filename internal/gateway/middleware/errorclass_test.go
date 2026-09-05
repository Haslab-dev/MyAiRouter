package middleware

import "testing"

func TestClassifyStatus(t *testing.T) {
	cases := []struct {
		code int
		want ErrorClass
	}{
		{0, ErrRetryable},         // network error / timeout
		{408, ErrRetryable},       // request timeout
		{429, ErrRetryable},       // rate limited
		{500, ErrRetryable},       // upstream crash
		{502, ErrRetryable},       // bad gateway
		{503, ErrRetryable},       // upstream unavailable
		{401, ErrAccountFailover}, // bad key
		{403, ErrAccountFailover}, // forbidden / out of credits
		{400, ErrTerminal},        // validation
		{404, ErrTerminal},        // unknown model
		{413, ErrTerminal},        // payload too large
		{422, ErrTerminal},        // unprocessable
		{402, ErrTerminal},        // payment required
	}
	for _, c := range cases {
		if got := ClassifyStatus(c.code); got != c.want {
			t.Errorf("ClassifyStatus(%d) = %v, want %v", c.code, got, c.want)
		}
	}
}

func TestClassifyStatusWithPolicy(t *testing.T) {
	t.Run("aggressive falls back on any HTTP status", func(t *testing.T) {
		for _, code := range []int{0, 400, 401, 403, 429, 500, 503} {
			if got := ClassifyStatusWithPolicy(code, "aggressive"); got != ErrRetryable {
				t.Errorf("aggressive(%d) = %v, want ErrRetryable", code, got)
			}
		}
	})

	t.Run("conservative only retries transient errors", func(t *testing.T) {
		for _, code := range []int{0, 408, 429, 500, 503} {
			if got := ClassifyStatusWithPolicy(code, "conservative"); got != ErrRetryable {
				t.Errorf("conservative(%d) = %v, want ErrRetryable", code, got)
			}
		}
		for _, code := range []int{400, 401, 403, 404, 422} {
			if got := ClassifyStatusWithPolicy(code, "conservative"); got != ErrTerminal {
				t.Errorf("conservative(%d) = %v, want ErrTerminal", code, got)
			}
		}
	})

	t.Run("auto matches default classification", func(t *testing.T) {
		for _, code := range []int{0, 400, 401, 429, 500} {
			if ClassifyStatusWithPolicy(code, "auto") != ClassifyStatus(code) {
				t.Errorf("auto(%d) diverges from default classification", code)
			}
			if ClassifyStatusWithPolicy(code, "") != ClassifyStatus(code) {
				t.Errorf("empty policy(%d) diverges from default classification", code)
			}
		}
	})
}
