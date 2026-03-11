import unittest
from types import SimpleNamespace
from unittest.mock import patch

import app


class LocationIntelTests(unittest.TestCase):
    def setUp(self):
        self.client = app.app.test_client()
        app.reverse_geocode_place.cache_clear()
        app.load_country_intel.cache_clear()
        app.load_open_meteo_place_profile.cache_clear()
        app.load_world_bank_population.cache_clear()
        app.load_open_meteo_country_profile.cache_clear()
        app.load_wikidata_country_facts.cache_clear()
        app._tle_cache.update(
            {
                "fetched_at": 0.0,
                "items": [],
                "source": "empty",
                "source_groups": [],
                "refreshing": False,
                "last_error": "",
                "last_attempt_at": 0.0,
            }
        )
        app._satnogs_cache.clear()

    def test_synthesize_location_summary_uses_country_facts(self):
        summary = app.synthesize_location_summary(
            "Mongolia",
            "Mongolia",
            {
                "region": "Asia",
                "subregion": "Eastern Asia",
                "capital": "Ulan Bator",
                "population_label": "3.5M",
                "languages": ["Mongolian"],
                "currencies": ["Mongolian togrog"],
                "independent": True,
                "un_member": True,
            },
        )
        self.assertIn("Mongolia is in Mongolia", summary)
        self.assertIn("The capital is Ulan Bator", summary)
        self.assertIn("population 3.5M", summary)

    @patch("app.load_nearby_landmarks", return_value=[])
    @patch(
        "app.load_country_intel", return_value={"capital": "Ulan Bator", "population_label": "3.5M"}
    )
    @patch("app.load_open_meteo_place_profile", return_value={})
    @patch("app.load_place_reference", return_value={})
    def test_build_location_intel_falls_back_when_wikipedia_missing(self, *_mocks):
        payload = app.build_location_intel("Mongolia", "Mongolia", 46.86, 103.84)
        self.assertEqual(payload["name"], "Mongolia")
        self.assertTrue(payload["summary"])
        self.assertEqual(payload["country_intel"]["capital"], "Ulan Bator")

    @patch("app.load_nearby_landmarks", return_value=[])
    @patch(
        "app.load_country_intel",
        return_value={
            "capital": "Edinburgh",
            "population_label": "69.0M",
            "population_year": "2024",
        },
    )
    @patch(
        "app.load_open_meteo_place_profile",
        return_value={"population_label": "10.0K", "distance_km": 1.2, "source": "Open-Meteo"},
    )
    @patch("app.load_place_reference", return_value={})
    def test_build_location_intel_separates_place_and_country_population(self, *_mocks):
        payload = app.build_location_intel("Whitburn", "United Kingdom", 55.86, -3.68)
        self.assertEqual(payload["place_intel"]["population_label"], "10.0K")
        self.assertEqual(payload["country_intel"]["population_label"], "69.0M")

    @patch("app.reverse_geocode_place_bigdatacloud")
    def test_reverse_geocode_place_prefers_bigdatacloud_details(self, mock_bigdatacloud):
        mock_bigdatacloud.return_value = {
            "name": "Qikiqtaaluk Region",
            "country": "Canada",
            "country_code": "CA",
            "region": "Nunavut",
            "display_name": "Qikiqtaaluk Region, Nunavut, Canada",
        }
        payload = app.reverse_geocode_place(65.77, -82.19)
        self.assertEqual(payload["name"], "Qikiqtaaluk Region")
        self.assertEqual(payload["region"], "Nunavut")
        self.assertEqual(payload["display_name"], "Qikiqtaaluk Region, Nunavut, Canada")

    @patch(
        "app.load_wikidata_country_facts",
        return_value={"government_type": "unitary parliamentary republic", "source": "Wikidata"},
    )
    @patch(
        "app.load_open_meteo_country_profile",
        return_value={"population": 3170208, "source": "Open-Meteo"},
    )
    @patch(
        "app.load_world_bank_population",
        return_value={"population": 3504000, "population_label": "3.5M", "population_year": "2024"},
    )
    @patch("app.requests.get")
    def test_load_country_intel_combines_multiple_sources(self, mock_get, *_mocks):
        mock_get.return_value = SimpleNamespace(
            ok=True,
            json=lambda: [
                {
                    "name": {"official": "Mongolia"},
                    "population": 3400000,
                    "capital": ["Ulaanbaatar"],
                    "region": "Asia",
                    "subregion": "Eastern Asia",
                    "currencies": {"MNT": {"name": "Mongolian togrog"}},
                    "languages": {"mon": "Mongolian"},
                    "timezones": ["UTC+08:00"],
                    "independent": True,
                    "unMember": True,
                    "cca2": "MN",
                    "flags": {"svg": "https://example.test/flag.svg"},
                }
            ],
        )
        payload = app.load_country_intel("Mongolia")
        self.assertEqual(payload["population"], 3504000)
        self.assertEqual(payload["population_label"], "3.5M")
        self.assertEqual(payload["population_year"], "2024")
        self.assertEqual(payload["government_type"], "unitary parliamentary republic")
        self.assertIn("REST Countries", payload["sources"])
        self.assertIn("World Bank", payload["sources"])
        self.assertIn("Open-Meteo", payload["sources"])
        self.assertIn("Wikidata", payload["sources"])

    def test_infer_satellite_profile_identifies_iss(self):
        profile = app.infer_satellite_profile({}, "ISS (ZARYA)")
        self.assertEqual(profile["purpose"], "Crewed space station")
        self.assertEqual(profile["owner_label"], "International partnership")
        self.assertEqual(profile["operator_type"], "Multinational / civil")

    def test_infer_satellite_profile_identifies_military_payload(self):
        profile = app.infer_satellite_profile({}, "USA 81")
        self.assertEqual(profile["purpose"], "Reconnaissance / surveillance")
        self.assertEqual(profile["owner_label"], "United States government")
        self.assertEqual(profile["operator_type"], "Government / military")

    def test_infer_satellite_profile_identifies_rocket_body(self):
        profile = app.infer_satellite_profile({}, "SL-16 R/B")
        self.assertEqual(profile["purpose"], "Rocket body")
        self.assertEqual(profile["owner_label"], "Soviet / Russian launch program")
        self.assertEqual(profile["operator_type"], "Government launch program")

    def test_infer_satellite_profile_identifies_named_upper_stage(self):
        profile = app.infer_satellite_profile({}, "ATLAS CENTAUR 2")
        self.assertEqual(profile["purpose"], "Rocket body")
        self.assertEqual(profile["owner_label"], "United States launch program")
        self.assertEqual(profile["operator_type"], "Government launch program")

    @patch("app.requests.get")
    def test_fetch_live_satellites_merges_groups_and_dedupes_by_catnr(self, mock_get):
        payloads = {
            "visual": """ISS (ZARYA)
1 25544U 98067A   26066.51879540  .00015903  00000+0  29038-3 0  9994
2 25544  51.6321  68.2848 0003503 147.9617 330.2048 15.49934412500783
HST
1 20580U 90037B   26066.19438100  .00000798  00000+0  34834-4 0  9993
2 20580  28.4694 322.0325 0001882  58.0536 302.0638 15.26235543863418
""",
            "stations": """ISS (ZARYA)
1 25544U 98067A   26066.51879540  .00015903  00000+0  29038-3 0  9994
2 25544  51.6321  68.2848 0003503 147.9617 330.2048 15.49934412500783
CSS (TIANHE)
1 48274U 21035A   26066.50000000  .00010000  00000+0  10000-3 0  9990
2 48274  41.4700 120.0000 0008000 180.0000 180.0000 15.60000000250000
""",
            "active": """TERRA
1 25994U 99068A   26066.50000000  .00000042  00000+0  18000-4 0  9996
2 25994  98.2050 120.0000 0001000  90.0000 270.0000 14.57100000123456
""",
        }

        def fake_get(url, **_kwargs):
            for group, payload in payloads.items():
                if f"GROUP={group}" in url:
                    return SimpleNamespace(text=payload, raise_for_status=lambda: None)
            raise AssertionError(url)

        mock_get.side_effect = fake_get
        items, groups = app._fetch_live_satellites()
        self.assertEqual(
            [item["name"] for item in items], ["ISS (ZARYA)", "HST", "CSS (TIANHE)", "TERRA"]
        )
        self.assertEqual([item["catnr"] for item in items], [25544, 20580, 48274, 25994])
        self.assertEqual(groups, ["visual", "stations", "active"])

    @patch("app.requests.get")
    def test_fetch_live_satellites_falls_back_to_satnogs(self, mock_get):
        satnogs_rows = [
            {
                "tle0": "0 ISS",
                "tle1": "1 25544U 98067A   26066.51879540  .00015903  00000+0  29038-3 0  9994",
                "tle2": "2 25544  51.6321  68.2848 0003503 147.9617 330.2048 15.49934412500783",
                "norad_cat_id": 25544,
            },
            {
                "tle0": "HST",
                "tle1": "1 20580U 90037B   26066.19438100  .00000798  00000+0  34834-4 0  9993",
                "tle2": "2 20580  28.4694 322.0325 0001882  58.0536 302.0638 15.26235543863418",
                "norad_cat_id": 20580,
            },
        ]

        def fake_get(url, **_kwargs):
            if "celestrak.org" in url:
                raise app.requests.RequestException("timeout")
            if "db.satnogs.org/api/tle/" in url:
                return SimpleNamespace(json=lambda: satnogs_rows, raise_for_status=lambda: None)
            raise AssertionError(url)

        mock_get.side_effect = fake_get
        items, groups = app._fetch_live_satellites()
        self.assertEqual([item["name"] for item in items], ["ISS", "HST"])
        self.assertEqual([item["catnr"] for item in items], [25544, 20580])
        self.assertEqual(groups, ["satnogs-tle"])

    @patch("app.requests.get")
    def test_load_satnogs_satellite_returns_metadata(self, mock_get):
        satnogs_rows = [
            {
                "norad_cat_id": 2768,
                "name": "ERS 20 (OV5-3)",
                "names": "OV5-3",
                "status": "alive",
                "launched": "1967-04-28T00:00:00Z",
                "website": "https://en.wikipedia.org/wiki/OV5-3",
                "countries": "US",
            }
        ]
        mock_get.return_value = SimpleNamespace(
            json=lambda: satnogs_rows, raise_for_status=lambda: None
        )
        payload = app.load_satnogs_satellite(2768)
        self.assertEqual(payload["name"], "ERS 20 (OV5-3)")
        self.assertEqual(payload["launched"], "1967-04-28T00:00:00Z")
        self.assertEqual(payload["countries"], "US")

    @patch("app.load_satellite_reference")
    @patch("app.load_satnogs_satellite")
    @patch("app.load_satcat_details")
    def test_satellite_endpoint_merges_satnogs_metadata_when_satcat_missing(
        self, mock_satcat, mock_satnogs, mock_reference
    ):
        mock_satcat.return_value = {}
        mock_satnogs.return_value = {
            "norad_cat_id": 2768,
            "name": "ERS 20 (OV5-3)",
            "names": "OV5-3",
            "status": "alive",
            "launched": "1967-04-28T00:00:00Z",
            "website": "https://en.wikipedia.org/wiki/OV5-3",
            "countries": "US",
            "citation": "SatNOGS DB",
        }
        mock_reference.return_value = {
            "summary": "Orbiting Vehicle 5-3 was launched on 28 April 1967.",
            "content_url": "https://en.wikipedia.org/wiki/OV5-3",
        }

        response = self.client.get("/api/satellite/2768?name=ERS%2020%20(OV5-3)")
        payload = response.get_json()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["object_name"], "ERS 20 (OV5-3)")
        self.assertEqual(payload["launch_date"], "1967-04-28")
        self.assertEqual(payload["countries"], ["United States"])
        self.assertEqual(payload["summary_url"], "https://en.wikipedia.org/wiki/OV5-3")
        self.assertEqual(payload["classification_source"], "SatNOGS DB + Name heuristic")

    @patch("app._start_satellite_refresh")
    def test_load_satellites_returns_fallback_immediately_when_cache_empty(self, mock_refresh):
        items = app.load_satellites()
        self.assertEqual([item["name"] for item in items], ["ISS (ZARYA)", "HST", "NOAA 15"])
        self.assertEqual(app._tle_cache["source"], "fallback")
        mock_refresh.assert_called_once()

    def test_country_endpoint_rejects_nan_coords(self):
        response = self.client.get("/api/country?lat=nan&lon=10")
        self.assertEqual(response.status_code, 400)

    def test_location_intel_endpoint_rejects_non_finite_coords(self):
        response = self.client.get("/api/location-intel?name=Test&country=Test&lat=1&lon=inf")
        self.assertEqual(response.status_code, 400)


if __name__ == "__main__":
    unittest.main()
