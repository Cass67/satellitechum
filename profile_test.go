package main

import "testing"

func TestInferSatelliteProfileIdentifiesISS(t *testing.T) {
	profile := inferSatelliteProfile(nil, "ISS (ZARYA)")
	if profile.Purpose != "Crewed space station" {
		t.Errorf("purpose = %q", profile.Purpose)
	}
	if profile.OwnerLabel != "International partnership" {
		t.Errorf("owner_label = %q", profile.OwnerLabel)
	}
	if profile.OperatorType != "Multinational / civil" {
		t.Errorf("operator_type = %q", profile.OperatorType)
	}
}

func TestInferSatelliteProfileIdentifiesMilitaryPayload(t *testing.T) {
	profile := inferSatelliteProfile(nil, "USA 81")
	if profile.Purpose != "Reconnaissance / surveillance" {
		t.Errorf("purpose = %q", profile.Purpose)
	}
	if profile.OwnerLabel != "United States government" {
		t.Errorf("owner_label = %q", profile.OwnerLabel)
	}
	if profile.OperatorType != "Government / military" {
		t.Errorf("operator_type = %q", profile.OperatorType)
	}
}

func TestInferSatelliteProfileIdentifiesRocketBody(t *testing.T) {
	profile := inferSatelliteProfile(nil, "SL-16 R/B")
	if profile.Purpose != "Rocket body" {
		t.Errorf("purpose = %q", profile.Purpose)
	}
	if profile.OwnerLabel != "Soviet / Russian launch program" {
		t.Errorf("owner_label = %q", profile.OwnerLabel)
	}
	if profile.OperatorType != "Government launch program" {
		t.Errorf("operator_type = %q", profile.OperatorType)
	}
}

func TestInferSatelliteProfileIdentifiesNamedUpperStage(t *testing.T) {
	profile := inferSatelliteProfile(nil, "ATLAS CENTAUR 2")
	if profile.Purpose != "Rocket body" {
		t.Errorf("purpose = %q", profile.Purpose)
	}
	if profile.OwnerLabel != "United States launch program" {
		t.Errorf("owner_label = %q", profile.OwnerLabel)
	}
	if profile.OperatorType != "Government launch program" {
		t.Errorf("operator_type = %q", profile.OperatorType)
	}
}
