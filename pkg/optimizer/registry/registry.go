package registry

import (
	"myAiRouter/pkg/optimizer"
	"sync"
)

var (
	passesMu sync.RWMutex
	passes   = make(map[string]optimizer.Pass)

	validatorsMu sync.RWMutex
	validators   = make(map[string]optimizer.Validator)

	enginesMu sync.RWMutex
	engines   = make(map[string]optimizer.EngineMetadata)

	analyzersMu sync.RWMutex
	analyzers   []optimizer.Analyzer

	profilesMu sync.RWMutex
	profiles   = make(map[string]optimizer.ProviderProfile)
)

func RegisterPass(p optimizer.Pass) {
	passesMu.Lock()
	defer passesMu.Unlock()
	passes[p.Name()] = p
}

func GetPass(name string) optimizer.Pass {
	passesMu.RLock()
	defer passesMu.RUnlock()
	return passes[name]
}

func GetPasses() map[string]optimizer.Pass {
	passesMu.RLock()
	defer passesMu.RUnlock()
	cloned := make(map[string]optimizer.Pass)
	for k, v := range passes {
		cloned[k] = v
	}
	return cloned
}

func RegisterValidator(v optimizer.Validator) {
	validatorsMu.Lock()
	defer validatorsMu.Unlock()
	validators[v.Name()] = v
}

func GetValidator(name string) optimizer.Validator {
	validatorsMu.RLock()
	defer validatorsMu.RUnlock()
	return validators[name]
}

func GetValidators() map[string]optimizer.Validator {
	validatorsMu.RLock()
	defer validatorsMu.RUnlock()
	cloned := make(map[string]optimizer.Validator)
	for k, v := range validators {
		cloned[k] = v
	}
	return cloned
}

func RegisterEngine(e optimizer.EngineMetadata) {
	enginesMu.Lock()
	defer enginesMu.Unlock()
	engines[e.ID] = e
}

func GetEngine(id string) (optimizer.EngineMetadata, bool) {
	enginesMu.RLock()
	defer enginesMu.RUnlock()
	e, exists := engines[id]
	return e, exists
}

func GetEngines() map[string]optimizer.EngineMetadata {
	enginesMu.RLock()
	defer enginesMu.RUnlock()
	cloned := make(map[string]optimizer.EngineMetadata)
	for k, v := range engines {
		cloned[k] = v
	}
	return cloned
}

func RegisterAnalyzer(a optimizer.Analyzer) {
	analyzersMu.Lock()
	defer analyzersMu.Unlock()
	analyzers = append(analyzers, a)
}

func GetAnalyzers() []optimizer.Analyzer {
	analyzersMu.RLock()
	defer analyzersMu.RUnlock()
	cloned := make([]optimizer.Analyzer, len(analyzers))
	copy(cloned, analyzers)
	return cloned
}

func RegisterProfile(p optimizer.ProviderProfile) {
	profilesMu.Lock()
	defer profilesMu.Unlock()
	profiles[p.Name] = p
}

func GetProfile(name string) (optimizer.ProviderProfile, bool) {
	profilesMu.RLock()
	defer profilesMu.RUnlock()
	p, exists := profiles[name]
	return p, exists
}
