use super::*;

fn make_valid_event(eid: &str) -> RawEvent {
    RawEvent {
        eid: eid.to_string(),
        seq: 1,
        t: "$page_view".to_string(),
        ts: 1700000000000,
        sid: "sid-1".to_string(),
        anon: "anon-1".to_string(),
        uid: None,
        props: HashMap::new(),
        set: None,
        set_once: None,
        url: None,
        referrer: None,
        window_id: None,
        pageview_id: None,
        offset: None,
        schema_v: Some(1),
        options: EventOptions::default(),
    }
}

// A valid UUIDv7 for use in tests.
const VALID_EID: &str = "01906b67-0000-7000-8000-000000000001";

#[test]
fn validate_accepts_valid_event() {
    let event = make_valid_event(VALID_EID);
    assert!(validate(&event).is_ok());
}

#[test]
fn validate_rejects_missing_eid() {
    let event = make_valid_event("");
    assert!(matches!(validate(&event), Err(AppError::BadRequest(_))));
}

#[test]
fn validate_rejects_non_uuid_eid() {
    let event = make_valid_event("not-a-uuid");
    assert!(matches!(validate(&event), Err(AppError::BadRequest(_))));
}

#[test]
fn validate_rejects_missing_sid() {
    let mut event = make_valid_event(VALID_EID);
    event.sid = String::new();
    assert!(matches!(validate(&event), Err(AppError::BadRequest(_))));
}

#[test]
fn validate_rejects_missing_event_name() {
    let mut event = make_valid_event(VALID_EID);
    event.t = String::new();
    assert!(matches!(validate(&event), Err(AppError::BadRequest(_))));
}

#[test]
fn classify_routes_exception_to_error() {
    assert!(matches!(classify("$exception"), DataType::Error));
}

#[test]
fn classify_routes_identify() {
    assert!(matches!(classify("$identify"), DataType::Identify));
    assert!(matches!(classify("$alias"), DataType::Identify));
}

#[test]
fn classify_routes_checkout() {
    assert!(matches!(classify("order_completed"), DataType::Checkout));
    assert!(matches!(classify("$checkout_started"), DataType::Checkout));
    assert!(matches!(classify("purchase"), DataType::Checkout));
}

#[test]
fn classify_routes_analytics_by_default() {
    assert!(matches!(classify("$page_view"), DataType::Analytics));
    assert!(matches!(classify("custom_event"), DataType::Analytics));
}

#[test]
fn event_options_all_default_false() {
    let opts: EventOptions = serde_json::from_str("{}").unwrap();
    assert!(!opts.disable_skew_correction);
    assert!(!opts.cookieless_mode);
    assert!(!opts.process_person_profile);
}

#[test]
fn event_options_disable_skew_correction_parsed() {
    let opts: EventOptions = serde_json::from_str(r#"{"disable_skew_correction":true}"#).unwrap();
    assert!(opts.disable_skew_correction);
    assert!(!opts.cookieless_mode);
    assert!(!opts.process_person_profile);
}

#[test]
fn event_options_cookieless_and_person_profile_parsed() {
    let opts: EventOptions =
        serde_json::from_str(r#"{"cookieless_mode":true,"process_person_profile":true}"#).unwrap();
    assert!(!opts.disable_skew_correction);
    assert!(opts.cookieless_mode);
    assert!(opts.process_person_profile);
}

#[test]
fn bloom_key_rotation_correct_format() {
    use chrono::TimeZone;
    let now = Utc.with_ymd_and_hms(2026, 7, 1, 12, 0, 0).unwrap();
    let (today, yesterday) = bloom_window_keys("idem:bloom", now);
    assert_eq!(today, "idem:bloom:20260701");
    assert_eq!(yesterday, "idem:bloom:20260630");
}

#[test]
fn bloom_key_rotation_crosses_year_boundary() {
    use chrono::TimeZone;
    let jan_1 = Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap();
    let (today, yesterday) = bloom_window_keys("idem:bloom", jan_1);
    assert_eq!(today, "idem:bloom:20260101");
    assert_eq!(yesterday, "idem:bloom:20251231");
}
