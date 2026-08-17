package main

import "strings"

var ownerCodeMap = map[string]string{
	"US":   "United States",
	"USA":  "United States",
	"PRC":  "China",
	"CIS":  "Commonwealth of Independent States",
	"ESA":  "European Space Agency",
	"JPN":  "Japan",
	"IND":  "India",
	"ARGN": "Argentina",
	"FR":   "France",
	"UK":   "United Kingdom",
}

var satnogsCountryMap = map[string]string{
	"US":  "United States",
	"RU":  "Russia",
	"UK":  "United Kingdom",
	"GB":  "United Kingdom",
	"CN":  "China",
	"PRC": "China",
	"JP":  "Japan",
	"IN":  "India",
	"ID":  "Indonesia",
	"FR":  "France",
	"DE":  "Germany",
	"IT":  "Italy",
	"CA":  "Canada",
	"AU":  "Australia",
	"ES":  "Spain",
	"AR":  "Argentina",
	"BR":  "Brazil",
	"IL":  "Israel",
	"KR":  "South Korea",
	"UA":  "Ukraine",
	"IR":  "Iran",
}

type SatelliteProfile struct {
	Purpose              string
	OwnerLabel           string
	OperatorType         string
	ObjectType           string
	ClassificationSource string
	CatalogSource        string
}

func anyContains(haystack string, needles ...string) bool {
	for _, n := range needles {
		if strings.Contains(haystack, n) {
			return true
		}
	}
	return false
}

func catalogOwnerLabel(details map[string]any) string {
	if v := strOf(details, "OWNER_DESC"); v != "" {
		return v
	}
	return ownerCodeMap[strings.ToUpper(strOf(details, "OWNER"))]
}

func normalizedObjectType(details map[string]any, fallbackName string) string {
	objectType := strings.ToUpper(strOf(details, "OBJECT_TYPE"))
	name := strings.ToUpper(strOf(details, "OBJECT_NAME"))
	if name == "" {
		name = strings.ToUpper(fallbackName)
	}
	if objectType != "" {
		return objectType
	}
	if strings.Contains(name, "R/B") {
		return "R/B"
	}
	if strings.Contains(name, "DEB") {
		return "DEB"
	}
	if name != "" {
		return "PAY"
	}
	return ""
}

// inferSatelliteProfile mirrors app.py infer_satellite_profile.
func inferSatelliteProfile(details map[string]any, fallbackName string) SatelliteProfile {
	name := strOf(details, "OBJECT_NAME")
	if name == "" {
		name = fallbackName
	}
	name = strings.TrimSpace(name)
	nameUpper := strings.ToUpper(name)
	objectType := normalizedObjectType(details, fallbackName)
	ownerLabel := catalogOwnerLabel(details)
	operatorType := ""
	purpose := ""
	source := "Name heuristic (satcat unavailable)"
	if len(details) > 0 {
		source = "CelesTrak satcat"
	}

	if objectType == "R/B" {
		purpose = "Rocket body"
		if strings.Contains(nameUpper, "ARIANE") {
			if ownerLabel == "" {
				ownerLabel = "Arianespace / Europe"
			}
			operatorType = "Commercial launch program"
		} else if anyContains(nameUpper, "ATLAS", "DELTA") {
			if ownerLabel == "" {
				ownerLabel = "United States launch program"
			}
			operatorType = "Government launch program"
		} else if anyContains(nameUpper, "SL-", "COSMOS", "INTERCOSMOS") {
			if ownerLabel == "" {
				ownerLabel = "Soviet / Russian launch program"
			}
			operatorType = "Government launch program"
		} else if anyContains(nameUpper, "CZ-", "LONG MARCH") {
			if ownerLabel == "" {
				ownerLabel = "Chinese launch program"
			}
			operatorType = "Government launch program"
		} else if anyContains(nameUpper, "H-2", "H-II") {
			if ownerLabel == "" {
				ownerLabel = "Japanese launch program"
			}
			operatorType = "Government launch program"
		} else if strings.Contains(nameUpper, "GSLV") {
			if ownerLabel == "" {
				ownerLabel = "Indian launch program"
			}
			operatorType = "Government launch program"
		}
		purpose = "Rocket body"
	} else if objectType == "DEB" {
		purpose = "Orbital debris"
		if operatorType == "" {
			operatorType = "Unspecified"
		}
	} else if anyContains(nameUpper, "ATLAS CENTAUR", "THOR AGENA") {
		purpose = "Rocket body"
		if ownerLabel == "" {
			ownerLabel = "United States launch program"
		}
		if operatorType == "" {
			operatorType = "Government launch program"
		}
	}

	if purpose == "" {
		if strings.Contains(nameUpper, "ISS") {
			purpose = "Crewed space station"
			if ownerLabel == "" {
				ownerLabel = "International partnership"
			}
			operatorType = "Multinational / civil"
		} else if anyContains(nameUpper, "CSS", "TIANHE") {
			purpose = "Crewed space station"
			if ownerLabel == "" {
				ownerLabel = "China Manned Space Program"
			}
			operatorType = "Government / civil"
		} else if anyContains(nameUpper, "HST", "HUBBLE", "OAO", "ASTRO-H", "HXMT", "KORONAS") {
			purpose = "Science observatory"
			if anyContains(nameUpper, "ASTRO-H") {
				if ownerLabel == "" {
					ownerLabel = "JAXA / Japan"
				}
			} else if strings.Contains(nameUpper, "HXMT") {
				if ownerLabel == "" {
					ownerLabel = "Chinese Academy of Sciences"
				}
			} else if strings.Contains(nameUpper, "KORONAS") {
				if ownerLabel == "" {
					ownerLabel = "Russian government"
				}
			} else {
				if ownerLabel == "" {
					ownerLabel = "NASA / partner agencies"
				}
			}
			if operatorType == "" {
				operatorType = "Government / civil"
			}
		} else if anyContains(nameUpper, "NOAA", "METEOR") {
			purpose = "Weather observation"
			if ownerLabel == "" {
				if strings.Contains(nameUpper, "NOAA") {
					ownerLabel = "NOAA / United States"
				} else {
					ownerLabel = "Russian government"
				}
			}
			if operatorType == "" {
				operatorType = "Government / civil"
			}
		} else if anyContains(nameUpper, "GOES", "METEOSAT", "HIMAWARI", "FENGYUN", " FY-", "ELEKTRO-L", "INSAT", "GOMS") {
			purpose = "Weather observation"
			switch {
			case strings.Contains(nameUpper, "GOES"):
				if ownerLabel == "" {
					ownerLabel = "NOAA / United States"
				}
			case strings.Contains(nameUpper, "METEOSAT"):
				if ownerLabel == "" {
					ownerLabel = "EUMETSAT"
				}
			case strings.Contains(nameUpper, "HIMAWARI"):
				if ownerLabel == "" {
					ownerLabel = "JMA / Japan"
				}
			case strings.Contains(nameUpper, "FENGYUN") || strings.Contains(nameUpper, " FY-"):
				if ownerLabel == "" {
					ownerLabel = "Chinese government"
				}
			case strings.Contains(nameUpper, "ELEKTRO-L") || strings.Contains(nameUpper, "GOMS"):
				if ownerLabel == "" {
					ownerLabel = "Russian government"
				}
			case strings.Contains(nameUpper, "INSAT"):
				if ownerLabel == "" {
					ownerLabel = "Indian government"
				}
			}
			if operatorType == "" {
				operatorType = "Government / civil"
			}
		} else if anyContains(nameUpper, "TERRA", "AQUA", "LANDSAT", "SEASAT", "ORBVIEW", "ENVISAT", "ERS-", "SAOCOM", "ALOS", "DAICHI", "RESURS", "OKEAN", "AJISAI", "MIDORI", "GAOFEN") {
			purpose = "Earth observation"
			switch {
			case anyContains(nameUpper, "TERRA", "AQUA", "LANDSAT", "SEASAT"):
				if ownerLabel == "" {
					ownerLabel = "NASA / United States"
				}
			case anyContains(nameUpper, "ENVISAT", "ERS-"):
				if ownerLabel == "" {
					ownerLabel = "European Space Agency"
				}
			case anyContains(nameUpper, "ALOS", "DAICHI", "AJISAI", "MIDORI"):
				if ownerLabel == "" {
					ownerLabel = "JAXA / Japan"
				}
			case strings.Contains(nameUpper, "SAOCOM"):
				if ownerLabel == "" {
					ownerLabel = "CONAE / Argentina"
				}
			case anyContains(nameUpper, "RESURS", "OKEAN"):
				if ownerLabel == "" {
					ownerLabel = "Russian government"
				}
			case strings.Contains(nameUpper, "ORBVIEW"):
				if ownerLabel == "" {
					ownerLabel = "Commercial Earth observation operator"
				}
				if operatorType == "" {
					operatorType = "Private / commercial"
				}
			case strings.Contains(nameUpper, "GAOFEN"):
				if ownerLabel == "" {
					ownerLabel = "Chinese government"
				}
			}
			if operatorType == "" {
				operatorType = "Government / civil"
			}
		} else if anyContains(nameUpper, "SENTINEL", "WORLDVIEW", "GEOEYE", "QUICKBIRD", "RADARSAT", "PLEIADES", "SPOT ", "CARTOSAT", "KANOPUS", "SKYSAT", "BLACKSKY", "ICEYE", "KOMPSAT") {
			purpose = "Earth observation"
			switch {
			case strings.Contains(nameUpper, "SENTINEL"):
				if ownerLabel == "" {
					ownerLabel = "European Union / ESA"
				}
			case anyContains(nameUpper, "WORLDVIEW", "GEOEYE", "QUICKBIRD", "SKYSAT", "BLACKSKY"):
				if ownerLabel == "" {
					ownerLabel = "Commercial Earth observation operator"
				}
				if operatorType == "" {
					operatorType = "Private / commercial"
				}
			case strings.Contains(nameUpper, "RADARSAT"):
				if ownerLabel == "" {
					ownerLabel = "Canada"
				}
			case anyContains(nameUpper, "PLEIADES", "SPOT "):
				if ownerLabel == "" {
					ownerLabel = "France / Airbus"
				}
			case strings.Contains(nameUpper, "CARTOSAT"):
				if ownerLabel == "" {
					ownerLabel = "ISRO / India"
				}
			case strings.Contains(nameUpper, "ICEYE"):
				if ownerLabel == "" {
					ownerLabel = "ICEYE"
				}
				if operatorType == "" {
					operatorType = "Private / commercial"
				}
			case strings.Contains(nameUpper, "KOMPSAT"):
				if ownerLabel == "" {
					ownerLabel = "South Korea"
				}
			default:
				if operatorType == "" {
					operatorType = "Government / civil"
				}
			}
			if operatorType == "" {
				operatorType = "Government / civil"
			}
		} else if anyContains(nameUpper, "STARLINK", "ONEWEB", "IRIDIUM", "ORBCOMM") {
			purpose = "Communications satellite"
			switch {
			case strings.Contains(nameUpper, "STARLINK"):
				if ownerLabel == "" {
					ownerLabel = "SpaceX"
				}
			case strings.Contains(nameUpper, "ONEWEB"):
				if ownerLabel == "" {
					ownerLabel = "Eutelsat OneWeb"
				}
			case strings.Contains(nameUpper, "IRIDIUM"):
				if ownerLabel == "" {
					ownerLabel = "Iridium"
				}
			case strings.Contains(nameUpper, "ORBCOMM"):
				if ownerLabel == "" {
					ownerLabel = "Orbcomm"
				}
			}
			if operatorType == "" {
				operatorType = "Private / commercial"
			}
		} else if anyContains(nameUpper, "INTELSAT", "EUTELSAT", "ASTRA", "GALAXY ", "TELSTAR", "DIRECTV", "ECHOSTAR", "SES-", "SES ", "O3B", "INMARSAT", "VIASAT", "TDRS", "TDRSS", "TURKSAT", "HISPASAT", "JCSAT", "SKYNET", "ANIK", "AMC-", "AMC ", "BADR", "NILESAT", "YAMAL", "EXPRESS-", "THAICOM", "CHINASAT", "APSTAR", "ASIASAT") {
			purpose = "Communications satellite"
			switch {
			case anyContains(nameUpper, "INTELSAT", "GALAXY ", "TELSTAR"):
				if ownerLabel == "" {
					ownerLabel = "Intelsat"
				}
			case anyContains(nameUpper, "EUTELSAT", "O3B"):
				if ownerLabel == "" {
					ownerLabel = "Eutelsat"
				}
			case strings.Contains(nameUpper, "ASTRA") || strings.Contains(nameUpper, "SES"):
				if ownerLabel == "" {
					ownerLabel = "SES"
				}
			case anyContains(nameUpper, "DIRECTV", "ECHOSTAR"):
				if ownerLabel == "" {
					ownerLabel = "United States broadcast operator"
				}
			case strings.Contains(nameUpper, "INMARSAT"):
				if ownerLabel == "" {
					ownerLabel = "Inmarsat"
				}
			case strings.Contains(nameUpper, "VIASAT"):
				if ownerLabel == "" {
					ownerLabel = "Viasat"
				}
			case anyContains(nameUpper, "TDRS", "TDRSS"):
				if ownerLabel == "" {
					ownerLabel = "NASA / United States"
				}
				if operatorType == "" {
					operatorType = "Government / civil"
				}
			case strings.Contains(nameUpper, "SKYNET"):
				if ownerLabel == "" {
					ownerLabel = "United Kingdom military communications"
				}
				if operatorType == "" {
					operatorType = "Government / military"
				}
			case strings.Contains(nameUpper, "TURKSAT"):
				if ownerLabel == "" {
					ownerLabel = "Turksat / Turkey"
				}
			case strings.Contains(nameUpper, "HISPASAT"):
				if ownerLabel == "" {
					ownerLabel = "Hispasat / Spain"
				}
			case strings.Contains(nameUpper, "JCSAT"):
				if ownerLabel == "" {
					ownerLabel = "SKY Perfect JSAT / Japan"
				}
			case strings.Contains(nameUpper, "ANIK"):
				if ownerLabel == "" {
					ownerLabel = "Telesat / Canada"
				}
			case anyContains(nameUpper, "BADR", "NILESAT", "YAMAL", "EXPRESS-", "THAICOM", "CHINASAT", "APSTAR", "ASIASAT"):
				if ownerLabel == "" {
					ownerLabel = "Regional communications operator"
				}
			}
			if operatorType == "" {
				operatorType = "Private / commercial"
			}
		} else if anyContains(nameUpper, "GPS", "NAVSTAR", "GALILEO", "GLONASS", "BEIDOU", "COMPASS", "QZS", "QZSS", "IRNSS", "NAVIC") {
			purpose = "Navigation satellite"
			switch {
			case anyContains(nameUpper, "GPS", "NAVSTAR"):
				if ownerLabel == "" {
					ownerLabel = "United States government"
				}
				if operatorType == "" {
					operatorType = "Government / military"
				}
			case strings.Contains(nameUpper, "GALILEO"):
				if ownerLabel == "" {
					ownerLabel = "European Union"
				}
				if operatorType == "" {
					operatorType = "Government / civil"
				}
			case strings.Contains(nameUpper, "GLONASS"):
				if ownerLabel == "" {
					ownerLabel = "Russian government"
				}
				if operatorType == "" {
					operatorType = "Government / military"
				}
			case anyContains(nameUpper, "BEIDOU", "COMPASS"):
				if ownerLabel == "" {
					ownerLabel = "Chinese government"
				}
				if operatorType == "" {
					operatorType = "Government / military"
				}
			case anyContains(nameUpper, "QZS", "QZSS"):
				if ownerLabel == "" {
					ownerLabel = "Japan"
				}
				if operatorType == "" {
					operatorType = "Government / civil"
				}
			case anyContains(nameUpper, "IRNSS", "NAVIC"):
				if ownerLabel == "" {
					ownerLabel = "India"
				}
				if operatorType == "" {
					operatorType = "Government / civil"
				}
			}
		} else if anyContains(nameUpper, "USA ", "NOSS", "ONYX", "LACROSSE", "HELIOS", "YAOGAN") {
			purpose = "Reconnaissance / surveillance"
			if strings.Contains(nameUpper, "USA ") || strings.Contains(nameUpper, "NOSS") {
				if ownerLabel == "" {
					ownerLabel = "United States government"
				}
			} else if strings.Contains(nameUpper, "HELIOS") {
				if ownerLabel == "" {
					ownerLabel = "French military"
				}
			} else if strings.Contains(nameUpper, "YAOGAN") {
				if ownerLabel == "" {
					ownerLabel = "Chinese government"
				}
			}
			if operatorType == "" {
				operatorType = "Government / military"
			}
		} else if anyContains(nameUpper, "NROL", "SBIRS", "DSP ", "NAVY", "COSMOS") {
			purpose = "Reconnaissance / surveillance"
			if anyContains(nameUpper, "NROL", "SBIRS", "DSP ", "NAVY") {
				if ownerLabel == "" {
					ownerLabel = "United States government"
				}
			} else if strings.Contains(nameUpper, "COSMOS") {
				if ownerLabel == "" {
					ownerLabel = "Soviet / Russian government"
				}
			}
			if operatorType == "" {
				operatorType = "Government / military"
			}
		} else if strings.Contains(nameUpper, "COSMO-SKYMED") {
			purpose = "Earth observation"
			if ownerLabel == "" {
				ownerLabel = "Italian government"
			}
			if operatorType == "" {
				operatorType = "Government / dual-use"
			}
		} else if strings.Contains(nameUpper, "COSMOS") {
			purpose = "Likely government or military mission"
			if ownerLabel == "" {
				ownerLabel = "Soviet / Russian government"
			}
			if operatorType == "" {
				operatorType = "Government / military"
			}
		} else if strings.Contains(nameUpper, "INTERCOSMOS") {
			purpose = "Scientific or technology mission"
			if ownerLabel == "" {
				ownerLabel = "Soviet / Russian government"
			}
			if operatorType == "" {
				operatorType = "Government / civil"
			}
		} else if strings.Contains(nameUpper, "ACS3") {
			purpose = "Technology demonstration"
			if ownerLabel == "" {
				ownerLabel = "NASA / United States"
			}
			if operatorType == "" {
				operatorType = "Government / civil"
			}
		}
	}

	if objectType == "PAY" && purpose == "" {
		purpose = "Payload satellite"
	}
	if purpose == "" {
		purpose = "Cataloged space object"
	}
	if ownerLabel == "" && strOf(details, "OWNER") != "" {
		ownerLabel = ownerCodeMap[strings.ToUpper(strOf(details, "OWNER"))]
	}
	if operatorType == "" {
		if ownerLabel != "" {
			operatorType = "Government / civil"
		} else {
			operatorType = "Unspecified"
		}
	}

	catalogSource := "Name heuristic"
	if strOf(details, "__source") == "space-track" {
		catalogSource = "Space-Track SATCAT"
	} else if len(details) > 0 {
		catalogSource = "CelesTrak SATCAT"
	}

	return SatelliteProfile{
		Purpose:              purpose,
		OwnerLabel:           ownerLabel,
		OperatorType:         operatorType,
		ObjectType:           objectType,
		ClassificationSource: source,
		CatalogSource:        catalogSource,
	}
}
