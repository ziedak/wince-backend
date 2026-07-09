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
        priority: None,
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
fn validate_accepts_missing_schema_v_as_legacy() {
    let mut event = make_valid_event(VALID_EID);
    event.schema_v = None;
    assert!(validate(&event).is_ok());
}

#[test]
fn validate_accepts_current_schema_v() {
    let mut event = make_valid_event(VALID_EID);
    event.schema_v = Some(MAX_SUPPORTED_SCHEMA_V);
    assert!(validate(&event).is_ok());
}

#[test]
fn validate_rejects_schema_v_above_supported_range() {
    let mut event = make_valid_event(VALID_EID);
    event.schema_v = Some(MAX_SUPPORTED_SCHEMA_V + 1);
    assert!(matches!(validate(&event), Err(AppError::BadRequest(_))));
}

#[test]
fn validate_rejects_schema_v_below_supported_range() {
    let mut event = make_valid_event(VALID_EID);
    event.schema_v = Some(0);
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
fn classify_routes_high_value_cart_actions_to_checkout() {
    assert!(matches!(classify("$cart_add"), DataType::Checkout));
    assert!(matches!(classify("$cart_remove"), DataType::Checkout));
    assert!(matches!(classify("$cart_purchase"), DataType::Checkout));
    assert!(matches!(classify("$cart_checkout_complete"), DataType::Checkout));
    assert!(matches!(classify("$cart_checkout_abandon"), DataType::Checkout));
    assert!(matches!(classify("$cart_coupon_applied"), DataType::Checkout));
    assert!(matches!(classify("$cart_coupon_failed"), DataType::Checkout));
}

#[test]
fn classify_routes_low_value_cart_actions_to_analytics() {
    // Not every `$cart_*` event is commerce-critical — e.g. a cart viewed/opened
    // event should stay on the default analytics path.
    assert!(matches!(classify("$cart_viewed"), DataType::Analytics));
    assert!(matches!(classify("$cart_opened"), DataType::Analytics));
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

// ─── Wire-format deserialization (real SDK keys + legacy aliases) ───────────

fn base_json_fields() -> &'static str {
    r#""eid":"01906b67-0000-7000-8000-000000000001","seq":1,"ts":1700000000000,"sid":"sid-1","anon":"anon-1""#
}

#[test]
fn raw_event_deserializes_real_sdk_wire_keys() {
    let json = format!(
        r#"{{{},"n":"$page_view","wid":"win-1","pvid":"pv-1"}}"#,
        base_json_fields()
    );
    let event: RawEvent = serde_json::from_str(&json).unwrap();
    assert_eq!(event.t, "$page_view");
    assert_eq!(event.window_id.as_deref(), Some("win-1"));
    assert_eq!(event.pageview_id.as_deref(), Some("pv-1"));
}

#[test]
fn raw_event_deserializes_legacy_alias_keys() {
    let json = format!(
        r#"{{{},"t":"$page_view","window_id":"win-1","pageview_id":"pv-1"}}"#,
        base_json_fields()
    );
    let event: RawEvent = serde_json::from_str(&json).unwrap();
    assert_eq!(event.t, "$page_view");
    assert_eq!(event.window_id.as_deref(), Some("win-1"));
    assert_eq!(event.pageview_id.as_deref(), Some("pv-1"));
}

#[test]
fn raw_event_rejects_both_primary_and_alias_key_present() {
    // serde's alias mechanism errors on duplicate field when both the
    // canonical key and its alias are present in the same object.
    let json = format!(
        r#"{{{},"n":"$page_view","t":"$page_view"}}"#,
        base_json_fields()
    );
    assert!(serde_json::from_str::<RawEvent>(&json).is_err());
}

#[test]
fn raw_event_priority_defaults_to_none_when_absent() {
    let json = format!(r#"{{{},"n":"$page_view"}}"#, base_json_fields());
    let event: RawEvent = serde_json::from_str(&json).unwrap();
    assert_eq!(event.priority, None);
}

#[test]
fn raw_event_priority_parsed_from_underscore_priority_key() {
    let json = format!(
        r#"{{{},"n":"$page_view","_priority":"critical"}}"#,
        base_json_fields()
    );
    let event: RawEvent = serde_json::from_str(&json).unwrap();
    assert_eq!(event.priority.as_deref(), Some("critical"));
}
