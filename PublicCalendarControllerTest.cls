@isTest
private class PublicCalendarControllerTest {
    
    @TestSetup
    static void setup() {
        // Create test events for the running user (System Admin in tests)
        List<Event> testEvents = new List<Event>();
        
        // Create regular events
        for (Integer i = 0; i < 3; i++) {
            Event evt = new Event(
                Subject = 'Test Event ' + i,
                StartDateTime = System.now().addDays(i),
                EndDateTime = System.now().addDays(i).addHours(1),
                OwnerId = UserInfo.getUserId()
            );
            testEvents.add(evt);
        }
        
        // Create an all-day event
        Event allDayEvent = new Event(
            Subject = 'All Day Event',
            ActivityDate = Date.today().addDays(7),
            IsAllDayEvent = true,
            OwnerId = UserInfo.getUserId()
        );
        testEvents.add(allDayEvent);
        
        insert testEvents;
    }
    
    @isTest
    static void testGetPublicCalendarEvents_WithCurrentUser() {
        // Test with current user (System Administrator in test context)
        Test.startTest();
        List<PublicCalendarController.CalendarEvent> events = 
            PublicCalendarController.getPublicCalendarEvents(UserInfo.getUserId());
        
        System.assertNotEquals(null, events);
        System.assert(events.size() >= 4, 'Expected at least 4 test events');
        
        // Verify event wrapper properties
        if (events.size() > 0) {
            PublicCalendarController.CalendarEvent firstEvent = events[0];
            System.assertNotEquals(null, firstEvent.id);
            System.assertNotEquals(null, firstEvent.title);
            System.assertNotEquals(null, firstEvent.startDateTime);
            System.assertNotEquals(null, firstEvent.endDateTime);
            System.assertNotEquals(null, firstEvent.ownerId);
            System.assertNotEquals(null, firstEvent.timezone);
            System.assert(firstEvent.isRecurring != null);
        }
        Test.stopTest();
    }
    
    @isTest
    static void testGetPublicCalendarEvents_BlankCalendarId() {
        // Blank calendar ID should use current user
        Test.startTest();
        List<PublicCalendarController.CalendarEvent> events = 
            PublicCalendarController.getPublicCalendarEvents('');
        
        System.assertNotEquals(null, events);
        Test.stopTest();
    }
    
    @isTest
    static void testGetPublicCalendarEvents_NullCalendarId() {
        // Null calendar ID should use current user
        Test.startTest();
        List<PublicCalendarController.CalendarEvent> events = 
            PublicCalendarController.getPublicCalendarEvents(null);
        
        System.assertNotEquals(null, events);
        Test.stopTest();
    }
    
    @isTest
    static void testGetPublicCalendars_Success() {
        Test.startTest();
        Map<String, String> calendars = PublicCalendarController.getPublicCalendars();
        
        System.assertNotEquals(null, calendars);
        System.assert(calendars.size() > 0);
        // Should include current user
        System.assert(calendars.containsKey(UserInfo.getUserId()));
        Test.stopTest();
    }
    
    @isTest
    static void testGetUserInfo_Success() {
        Test.startTest();
        Map<String, String> userInfo = PublicCalendarController.getUserInfo();
        
        System.assertNotEquals(null, userInfo);
        System.assert(userInfo.containsKey('timezone'));
        System.assert(userInfo.containsKey('timezoneOffset'));
        System.assert(userInfo.containsKey('locale'));
        Test.stopTest();
    }
    
    /* COMMENTED OUT - testRecurringEvents method not used in LWC
    @isTest
    static void testTestRecurringEvents_Success() {
        Test.startTest();
        String result = PublicCalendarController.testRecurringEvents(UserInfo.getUserId());
        
        System.assertNotEquals(null, result);
        System.assert(result.contains('RECURRING EVENTS DEBUG'));
        System.assert(result.contains('Target Calendar ID'));
        Test.stopTest();
    }
    
    @isTest
    static void testTestRecurringEvents_BlankCalendarId() {
        Test.startTest();
        String result = PublicCalendarController.testRecurringEvents('');
        
        System.assertNotEquals(null, result);
        System.assert(result.contains('RECURRING EVENTS DEBUG'));
        Test.stopTest();
    }
    
    @isTest
    static void testTestRecurringEvents_NullCalendarId() {
        Test.startTest();
        String result = PublicCalendarController.testRecurringEvents(null);
        
        System.assertNotEquals(null, result);
        System.assert(result.contains('RECURRING EVENTS DEBUG'));
        Test.stopTest();
    }
    */
    
    @isTest
    static void testCalendarEventWrapper_Properties() {
        // Test the CalendarEvent wrapper class properties
        Test.startTest();
        PublicCalendarController.CalendarEvent calEvent = new PublicCalendarController.CalendarEvent();
        
        // Set all properties to ensure they work
        calEvent.id = 'test123';
        calEvent.title = 'Test Event';
        calEvent.startDateTime = System.now();
        calEvent.endDateTime = System.now().addHours(1);
        calEvent.ownerId = UserInfo.getUserId();
        calEvent.description = 'Test Description';
        calEvent.startDateTimeStr = 'test start';
        calEvent.endDateTimeStr = 'test end';
        calEvent.timezone = 'America/Los_Angeles';
        calEvent.location = 'Test Location';
        calEvent.type = 'Meeting';
        calEvent.isRecurring = true;
        calEvent.isRecurringEnhanced = true;
        calEvent.recurrencePatternText = 'FREQ=DAILY';
        calEvent.isRecurringClassic = false;
        calEvent.recurrenceActivityId = 'testActivityId';
        
        // Verify properties are set
        System.assertEquals('test123', calEvent.id);
        System.assertEquals('Test Event', calEvent.title);
        System.assertEquals(true, calEvent.isRecurring);
        System.assertEquals('FREQ=DAILY', calEvent.recurrencePatternText);
        Test.stopTest();
    }
}