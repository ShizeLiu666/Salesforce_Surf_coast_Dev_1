public without sharing class PublicCalendarController {
    
    // Custom exception for unauthorized access
    public class UnauthorizedException extends Exception {}
    
    // Inner class to represent calendar events
    public class CalendarEvent {
        @AuraEnabled public String id { get; set; }
        @AuraEnabled public String title { get; set; }
        @AuraEnabled public Datetime startDateTime { get; set; }
        @AuraEnabled public Datetime endDateTime { get; set; }
        @AuraEnabled public String ownerId { get; set; }
        @AuraEnabled public String description { get; set; }
        @AuraEnabled public String startDateTimeStr { get; set; }
        @AuraEnabled public String endDateTimeStr { get; set; }
        @AuraEnabled public String timezone { get; set; }
        @AuraEnabled public String location { get; set; }
        @AuraEnabled public String type { get; set; }
        @AuraEnabled public Boolean isRecurring { get; set; }
        @AuraEnabled public Boolean isRecurringEnhanced { get; set; }
        @AuraEnabled public String recurrencePatternText { get; set; }
        @AuraEnabled public Boolean isRecurringClassic { get; set; }
        @AuraEnabled public String recurrenceActivityId { get; set; }
    }
    
    @AuraEnabled
    public static List<CalendarEvent> getPublicCalendarEvents(String calendarId) {
        System.debug('🚀 NEW CODE EXECUTING - getPublicCalendarEvents called at: ' + System.now());
        try {
            // Check user profile
            if (!isUserAuthorized()) {
                throw new UnauthorizedException('You do not have permission to view this calendar');
            }
            
            // For testing, let's use the current user's calendar if no ID provided
            String targetCalendarId = String.isNotBlank(calendarId) ? calendarId : UserInfo.getUserId();
            
            // Get current user's timezone
            String userTimeZone = UserInfo.getTimeZone().getID();
            System.debug('User timezone: ' + userTimeZone);
            
            // COMPREHENSIVE RECURRING EVENTS ANALYSIS
            System.debug('=== COMPREHENSIVE RECURRING EVENTS ANALYSIS ===');
            System.debug('🧭 Target Calendar ID (getPublicCalendarEvents): ' + targetCalendarId);
            System.debug('Target Calendar Owner ID: ' + targetCalendarId);
            
            // Step 1: Find events where IsRecurrence2 = true
            List<Event> recurringEventsNew = [
                SELECT Id, Subject, IsRecurrence2, Recurrence2PatternText, IsRecurrence, RecurrenceActivityId
                FROM Event 
                WHERE OwnerId = :targetCalendarId
                AND IsRecurrence2 = true
                LIMIT 500
            ];
            System.debug('🔍 STEP 1: Events with IsRecurrence2 = true: ' + recurringEventsNew.size());
            
            // Step 2: Find events where IsRecurrence = true (classic)
            List<Event> recurringEventsClassic = [
                SELECT Id, Subject, IsRecurrence2, Recurrence2PatternText, IsRecurrence, RecurrenceActivityId
                FROM Event 
                WHERE OwnerId = :targetCalendarId
                AND IsRecurrence = true
                LIMIT 500
            ];
            System.debug('🔍 STEP 2: Events with IsRecurrence = true (classic): ' + recurringEventsClassic.size());
            
            // Step 3: Find events with RecurrenceActivityId
            List<Event> eventsWithActivityId = [
                SELECT Id, Subject, IsRecurrence2, Recurrence2PatternText, IsRecurrence, RecurrenceActivityId
                FROM Event 
                WHERE OwnerId = :targetCalendarId
                AND RecurrenceActivityId != null
                LIMIT 500
            ];
            System.debug('🔍 STEP 3: Events with RecurrenceActivityId: ' + eventsWithActivityId.size());
            
            // Step 4: Sample of ALL events to check for patterns in memory
            List<Event> allEventsSample = [
                SELECT Id, Subject, IsRecurrence2, Recurrence2PatternText, IsRecurrence, RecurrenceActivityId,
                       StartDateTime, EndDateTime
                FROM Event 
                WHERE OwnerId = :targetCalendarId
                ORDER BY StartDateTime DESC
                LIMIT 10
            ];
            System.debug('🔍 STEP 4: Recent 10 events for analysis:');
            Integer eventsWithPatterns = 0;
            for (Event evt : allEventsSample) {
                String activityIdStr = 'null';
                try {
                    activityIdStr = evt.RecurrenceActivityId != null ? String.valueOf(evt.RecurrenceActivityId) : 'null';
                } catch (Exception ex) {
                    activityIdStr = 'ERROR_ACCESSING_ID';
                }
                
                if (String.isNotBlank(evt.Recurrence2PatternText)) {
                    eventsWithPatterns++;
                }
                
                System.debug('📅 Event: "' + evt.Subject + '"' +
                    ' | Start: ' + evt.StartDateTime +
                    ' | IsRecurrence2: ' + evt.IsRecurrence2 + 
                    ' | Pattern: "' + evt.Recurrence2PatternText + '"' +
                    ' | IsRecurrence: ' + evt.IsRecurrence +
                    ' | ActivityId: ' + activityIdStr);
            }
            System.debug('🔍 STEP 5: Events with pattern text in sample: ' + eventsWithPatterns + ' out of ' + allEventsSample.size());
            System.debug('=== END COMPREHENSIVE ANALYSIS ===');
            
            // Define date range for query (no hardcoded dates)
            Datetime rangeStart = System.now().addMonths(-6);
            Datetime rangeEnd = System.now().addMonths(6);
            Date startDate = rangeStart.date();
            Date endDate = rangeEnd.date();
            
            System.debug('Date range: ' + rangeStart + ' to ' + rangeEnd);
            System.debug('Current date: ' + System.now());
            
            // Query events - TWO SEPARATE QUERIES APPROACH
            // 1. Get single events in date range
            List<Event> singleEvents = [
                SELECT Id, Subject, 
                       StartDateTime, EndDateTime, ActivityDate, IsAllDayEvent, DurationInMinutes,
                       OwnerId,
                       IsRecurrence2, Recurrence2PatternText,
                       IsRecurrence, RecurrenceActivityId
                FROM Event
                WHERE OwnerId = :targetCalendarId
                AND IsDeleted = false
                AND IsRecurrence2 = false
                AND IsRecurrence = false
                AND RecurrenceActivityId = null
                AND (
                    (StartDateTime < :rangeEnd AND EndDateTime > :rangeStart)
                    OR (IsAllDayEvent = true AND ActivityDate >= :startDate AND ActivityDate <= :endDate)
                )
                ORDER BY StartDateTime ASC, ActivityDate ASC
                LIMIT 250
            ];
            
            // 2. Get recurring events — NOW date-bounded like singles
            // Includes classic/enhanced masters and also instances (RecurrenceActivityId != null)
            List<Event> recurringMasters = [
                SELECT Id, Subject, 
                       StartDateTime, EndDateTime, ActivityDate, IsAllDayEvent, DurationInMinutes,
                       OwnerId,
                       IsRecurrence2, Recurrence2PatternText,
                       IsRecurrence, RecurrenceActivityId
                FROM Event
                WHERE OwnerId = :targetCalendarId
                AND IsDeleted = false
                AND (IsRecurrence2 = true OR IsRecurrence = true OR RecurrenceActivityId != null)
                AND (
                    (StartDateTime < :rangeEnd AND EndDateTime > :rangeStart)
                    OR (IsAllDayEvent = true AND ActivityDate >= :startDate AND ActivityDate <= :endDate)
                )
                ORDER BY StartDateTime ASC, ActivityDate ASC
                LIMIT 1000
            ];
            System.debug('Parity note: recurring query is date-bounded and includes RecurrenceActivityId != null to align with testRecurringEvents');
            
            // Combine both lists
            List<Event> events = new List<Event>();
            events.addAll(singleEvents);
            events.addAll(recurringMasters);
            
            System.debug('🔍 SPLIT QUERY RESULTS:');
            System.debug('Single events found: ' + singleEvents.size());
            System.debug('Recurring (masters + instances) found: ' + recurringMasters.size());
            System.debug('Total events combined: ' + events.size());
            
            System.debug('Main query found ' + events.size() + ' events');
            
            // Debug: Show sample of events found by main query
            System.debug('=== MAIN QUERY EVENTS SAMPLE ===');
            for (Integer i = 0; i < Math.min(100, events.size()); i++) {
                Event evt = events[i];
                System.debug('Event ' + (i+1) + ': ' + evt.Subject + 
                    ' | Start: ' + evt.StartDateTime + 
                    ' | IsRecurrence2: ' + String.valueOf(evt.IsRecurrence2) + 
                    ' | IsRecurrence: ' + String.valueOf(evt.IsRecurrence));
            }
            System.debug('=== END MAIN QUERY SAMPLE ===');
            
            System.debug('Found ' + events.size() + ' events');
            
            // Debug: Count recurring vs single events
            Integer recurringCount = 0;
            Integer singleCount = 0;
            for (Event evt : events) {
                Boolean hasRecurrenceActivityId = false;
                try {
                    hasRecurrenceActivityId = (evt.RecurrenceActivityId != null);
                } catch (Exception ex) {
                    System.debug('Error accessing RecurrenceActivityId in counting loop: ' + ex.getMessage());
                    hasRecurrenceActivityId = false;
                }
                
                if ((evt.IsRecurrence2 == true) || hasRecurrenceActivityId || (evt.IsRecurrence == true)) {
                    recurringCount++;
                } else {
                    singleCount++;
                }
            }
            System.debug('Recurring events: ' + recurringCount + ', Single events: ' + singleCount);
            
            // Convert to wrapper class
            List<CalendarEvent> calendarEvents = new List<CalendarEvent>();
            for (Event evt : events) {
                CalendarEvent calEvent = new CalendarEvent();
                calEvent.id = evt.Id;
                calEvent.title = evt.Subject != null ? evt.Subject : 'Untitled Event';
                calEvent.ownerId = evt.OwnerId;
                calEvent.description = null; // Description field not available in this org
                calEvent.timezone = userTimeZone;
                calEvent.location = null; // Location field not available in this org
                calEvent.type = null; // Type field not available in this org
                
                // Set recurring event information
                calEvent.isRecurringEnhanced = evt.IsRecurrence2 != null ? evt.IsRecurrence2 : false;
                calEvent.recurrencePatternText = evt.Recurrence2PatternText;
                calEvent.isRecurringClassic = evt.IsRecurrence != null ? evt.IsRecurrence : false;
                
                // Safe access to RecurrenceActivityId
                try {
                    calEvent.recurrenceActivityId = evt.RecurrenceActivityId;
                } catch (Exception ex) {
                    System.debug('Error accessing RecurrenceActivityId in wrapper assignment: ' + ex.getMessage());
                    calEvent.recurrenceActivityId = null;
                }
                
                // NEW: consider instances as recurring if they have RecurrenceActivityId
                Boolean hasRecurrenceActivityId = (calEvent.recurrenceActivityId != null);
                calEvent.isRecurring = calEvent.isRecurringEnhanced || calEvent.isRecurringClassic || hasRecurrenceActivityId;
                
                // Handle all-day events
                if (evt.IsAllDayEvent && evt.ActivityDate != null) {
                    calEvent.startDateTime = Datetime.newInstance(evt.ActivityDate, Time.newInstance(0, 0, 0, 0));
                    calEvent.endDateTime = Datetime.newInstance(evt.ActivityDate, Time.newInstance(23, 59, 59, 0));
                } else if (evt.StartDateTime != null) {
                    // Regular events - Salesforce stores these in GMT
                    calEvent.startDateTime = evt.StartDateTime;
                    calEvent.endDateTime = evt.EndDateTime != null ? evt.EndDateTime : evt.StartDateTime.addMinutes(60);
                } else {
                    continue; // Skip events without proper date/time
                }
                
                // Format datetime strings in user's timezone
                calEvent.startDateTimeStr = calEvent.startDateTime.format('yyyy-MM-dd\'T\'HH:mm:ss');
                calEvent.endDateTimeStr = calEvent.endDateTime.format('yyyy-MM-dd\'T\'HH:mm:ss');
                
                // Debug output - COMPREHENSIVE DATA CHECK
                System.debug('=== EVENT WRAPPER DATA ===');
                System.debug('Event: ' + calEvent.title);
                System.debug('  ID: ' + calEvent.id);
                System.debug('  Start (GMT): ' + calEvent.startDateTime);
                System.debug('  Start (User TZ): ' + calEvent.startDateTimeStr);
                System.debug('  End (GMT): ' + calEvent.endDateTime);
                System.debug('  End (User TZ): ' + calEvent.endDateTimeStr);
                System.debug('  Description: ' + (calEvent.description != null ? calEvent.description : 'null'));
                System.debug('  Location: ' + (calEvent.location != null ? calEvent.location : 'null (field not available)'));
                System.debug('  Type: ' + (calEvent.type != null ? calEvent.type : 'null (field not available)'));
                System.debug('  Timezone: ' + calEvent.timezone);
                
                // Debug recurring event info
                System.debug('  Is Recurring: ' + calEvent.isRecurring);
                if (calEvent.isRecurring) {
                    System.debug('  Recurring Enhanced: ' + calEvent.isRecurringEnhanced);
                    System.debug('  Recurrence Pattern: ' + (calEvent.recurrencePatternText != null ? calEvent.recurrencePatternText : 'null'));
                    System.debug('  Recurring Classic: ' + calEvent.isRecurringClassic);
                    System.debug('  Recurrence Activity ID: ' + (calEvent.recurrenceActivityId != null ? calEvent.recurrenceActivityId : 'null'));
                } else {
                    System.debug('  Single Event');
                }
                System.debug('=== END EVENT DATA ===');
                
                calendarEvents.add(calEvent);
            }
            
            // Final summary of what's being returned to frontend
            System.debug('=== FINAL SUMMARY ===');
            System.debug('Returning ' + calendarEvents.size() + ' events to frontend');
            Integer recurringReturned = 0;
            Integer singleReturned = 0;
            for (CalendarEvent ce : calendarEvents) {
                if (ce.isRecurring) {
                    recurringReturned++;
                    System.debug('🔄 RECURRING EVENT TO FRONTEND: ' + ce.title + 
                        ' | isRecurring: ' + ce.isRecurring + 
                        ' | Pattern: "' + (ce.recurrencePatternText != null ? ce.recurrencePatternText : 'NULL') + '"');
                } else {
                    singleReturned++;
                }
            }
            System.debug('Recurring events returned: ' + recurringReturned);
            System.debug('Single events returned: ' + singleReturned);
            
            // CRITICAL DEBUG: Show first few events being returned
            System.debug('🔍 FIRST 3 EVENTS BEING RETURNED TO FRONTEND:');
            for (Integer i = 0; i < Math.min(3, calendarEvents.size()); i++) {
                CalendarEvent ce = calendarEvents[i];
                System.debug('Event ' + (i+1) + ': ' + ce.title + 
                    ' | isRecurring: ' + ce.isRecurring +
                    ' | isRecurringEnhanced: ' + ce.isRecurringEnhanced +
                    ' | Pattern: "' + (ce.recurrencePatternText != null ? ce.recurrencePatternText : 'NULL') + '"');
            }
            System.debug('=== END SUMMARY ===');
            
            return calendarEvents;
            
        } catch (UnauthorizedException e) {
            throw new AuraHandledException(e.getMessage());
        } catch (Exception e) {
            System.debug('Error in getPublicCalendarEvents: ' + e.getMessage() + ' - ' + e.getStackTraceString());
            throw new AuraHandledException('Error retrieving calendar events: ' + e.getMessage());
        }
    }
    
    @AuraEnabled(cacheable=true)
    public static Map<String, String> getPublicCalendars() {
        try {
            // Check user profile
            if (!isUserAuthorized()) {
                throw new UnauthorizedException('You do not have permission to view calendars');
            }
            
            Map<String, String> calendars = new Map<String, String>();
            
            // Add current user as an option
            calendars.put(UserInfo.getUserId(), UserInfo.getName() + ' (My Calendar)');
            System.debug('🧭 Target Calendar ID context (getPublicCalendars, default user): ' + UserInfo.getUserId());
            
            // Try to find Resource calendars
            try {
                List<User> resourceCalendars = [
                    SELECT Id, Name
                    FROM User
                    WHERE IsActive = true
                    AND UserType = 'Resource'
                    ORDER BY Name
                    LIMIT 100
                ];
                
                for (User cal : resourceCalendars) {
                    calendars.put(cal.Id, cal.Name);
                }
            } catch (Exception e) {
                System.debug('No resource calendars found: ' + e.getMessage());
            }
            
            return calendars;
            
        } catch (UnauthorizedException e) {
            throw new AuraHandledException(e.getMessage());
        } catch (Exception e) {
            System.debug('Error in getPublicCalendars: ' + e.getMessage());
            throw new AuraHandledException('Error retrieving calendars: ' + e.getMessage());
        }
    }
    
    @AuraEnabled(cacheable=true)
    public static Map<String, String> getUserInfo() {
        Map<String, String> info = new Map<String, String>();
        info.put('timezone', UserInfo.getTimeZone().getID());
        info.put('timezoneOffset', String.valueOf(UserInfo.getTimeZone().getOffset(System.now()) / 1000 / 60)); // offset in minutes
        info.put('locale', UserInfo.getLocale());
        return info;
    }
    
    // Test method to debug recurring events - COMMENTED OUT (not used in LWC)
    /*
    @AuraEnabled
    public static String testRecurringEvents(String calendarId) {
        try {
            // Better null handling for calendarId
            String targetCalendarId;
            if (String.isNotBlank(calendarId)) {
                targetCalendarId = calendarId;
            } else {
                targetCalendarId = UserInfo.getUserId();
            }
            
            // Validate targetCalendarId
            if (String.isBlank(targetCalendarId)) {
                return 'ERROR: Unable to determine calendar ID. CalendarId parameter: ' + calendarId + ', UserInfo.getUserId(): ' + UserInfo.getUserId();
            }
            
            System.debug('Target Calendar ID: ' + targetCalendarId);
            
            // Test date ranges
            Datetime rangeStart = System.now().addMonths(-6);
            Datetime rangeEnd = System.now().addMonths(6);
            
            // Test 1: All events for this owner
            List<Event> allEvents = [
                SELECT Id, Subject, StartDateTime, EndDateTime, IsRecurrence2, Recurrence2PatternText, IsRecurrence, RecurrenceActivityId
                FROM Event 
                WHERE OwnerId = :targetCalendarId
                ORDER BY StartDateTime ASC
                LIMIT 2000
            ];
            
            // Check for null events in the main query result
            Integer nullEventCount = 0;
            for (Event evt : allEvents) {
                if (evt == null) {
                    nullEventCount++;
                }
            }
            if (nullEventCount > 0) {
                System.debug('WARNING: Found ' + nullEventCount + ' null events in allEvents query');
            }
            
            // Test 2: Only recurring events
            List<Event> recurringEvents = [
                SELECT Id, Subject, StartDateTime, EndDateTime, IsRecurrence2, Recurrence2PatternText, IsRecurrence, RecurrenceActivityId
                FROM Event 
                WHERE OwnerId = :targetCalendarId
                AND (IsRecurrence2 = true OR RecurrenceActivityId != null OR IsRecurrence = true)
                ORDER BY StartDateTime ASC
                LIMIT 1000
            ];
            
            // Test 3: Recurring events in date range
            List<Event> recurringInRange = [
                SELECT Id, Subject, StartDateTime, EndDateTime, IsRecurrence2, Recurrence2PatternText, IsRecurrence, RecurrenceActivityId
                FROM Event 
                WHERE OwnerId = :targetCalendarId
                AND (IsRecurrence2 = true OR RecurrenceActivityId != null OR IsRecurrence = true)
                AND (StartDateTime < :rangeEnd AND EndDateTime > :rangeStart)
                ORDER BY StartDateTime ASC
                LIMIT 1000
            ];
            
            String result = 'RECURRING EVENTS DEBUG\n';
            result += '======================\n';
            result += 'Current Date: ' + System.now().format() + '\n';
            result += 'Query Range: ' + rangeStart.format() + ' to ' + rangeEnd.format() + '\n';
            result += 'Target Calendar ID: ' + targetCalendarId + '\n';
            result += 'Total Events: ' + allEvents.size() + '\n';
            result += 'All Recurring Events: ' + recurringEvents.size() + '\n';
            result += 'Recurring Events in Range: ' + recurringInRange.size() + '\n\n';
            
            if (recurringEvents.size() > 0) {
                result += 'RECURRING EVENTS (with ALL field data):\n';
                for (Integer i = 0; i < Math.min(20, recurringEvents.size()); i++) {
                    Event evt = recurringEvents[i];
                    String startStr = evt.StartDateTime != null ? evt.StartDateTime.format() : 'null';
                    String endStr = evt.EndDateTime != null ? evt.EndDateTime.format() : 'null';
                    result += '- ' + evt.Subject + 
                        ' | Start: ' + startStr + 
                        ' | End: ' + endStr + 
                        ' | IsRecurrence2: ' + String.valueOf(evt.IsRecurrence2) + 
                        ' | Pattern: ' + (evt.Recurrence2PatternText != null ? evt.Recurrence2PatternText : 'null') + '\n';
                }
                
                result += '\nRECURRING EVENTS IN DATE RANGE (first 20):\n';
                for (Integer i = 0; i < Math.min(20, recurringInRange.size()); i++) {
                    Event evt = recurringInRange[i];
                    String startStr = evt.StartDateTime != null ? evt.StartDateTime.format() : 'null';
                    result += '- ' + evt.Subject + ' | Start: ' + startStr + '\n';
                }
            } else {
                result += 'NO RECURRING EVENTS FOUND for owner: ' + targetCalendarId + '\n';
            }
            
            // Add single events debug section
            List<Event> singleEvents = new List<Event>();
            for (Event evt : allEvents) {
                if (evt == null) {
                    System.debug('WARNING: Found null event in allEvents list');
                    continue;
                }
                
                try {
                    Boolean isRecurrence2 = evt.IsRecurrence2 != null ? evt.IsRecurrence2 : false;
                    Boolean isRecurrence = evt.IsRecurrence != null ? evt.IsRecurrence : false;
                    String recurrenceActivityId = null;
                    try {
                        recurrenceActivityId = evt.RecurrenceActivityId;
                    } catch (Exception idEx) {
                        System.debug('Error accessing RecurrenceActivityId for event: ' + evt.Id + ' - ' + idEx.getMessage());
                        recurrenceActivityId = null;
                    }
                    
                    if (!isRecurrence2 && String.isBlank(recurrenceActivityId) && !isRecurrence) {
                        singleEvents.add(evt);
                    }
                } catch (Exception evtEx) {
                    System.debug('Error processing event in single events filter: ' + evtEx.getMessage());
                    continue;
                }
            }
            
            result += '\n\nSINGLE EVENTS DEBUG\n';
            result += '==================\n';
            result += 'Single Events Found: ' + singleEvents.size() + '\n\n';
            
            if (singleEvents.size() > 0) {
                result += 'SINGLE EVENTS (with ALL field data):\n';
                for (Integer i = 0; i < Math.min(20, singleEvents.size()); i++) {
                    Event evt = singleEvents[i];
                    
                    if (evt == null) {
                        result += '- NULL EVENT at index ' + i + '\n';
                        continue;
                    }
                    
                    String startStr = evt.StartDateTime != null ? evt.StartDateTime.format() : 'null';
                    String endStr = evt.EndDateTime != null ? evt.EndDateTime.format() : 'null';
                    String subjectStr = evt.Subject != null ? evt.Subject : 'No Subject';
                    String eventId = evt.Id != null ? evt.Id : 'NULL_ID';
                    String recurrenceActivityIdStr = 'null';
                    try {
                        if (evt.RecurrenceActivityId != null) {
                            recurrenceActivityIdStr = evt.RecurrenceActivityId;
                        }
                    } catch (Exception idEx) {
                        recurrenceActivityIdStr = 'ERROR_ACCESSING_ID';
                    }
                    
                    result += '- ' + subjectStr + ' (ID: ' + eventId + ')' +
                        ' | Start: ' + startStr + 
                        ' | End: ' + endStr + 
                        ' | IsRecurrence2: ' + (evt.IsRecurrence2 != null ? String.valueOf(evt.IsRecurrence2) : 'null') + 
                        ' | IsRecurrence: ' + (evt.IsRecurrence != null ? String.valueOf(evt.IsRecurrence) : 'null') + 
                        ' | RecurrenceActivityId: ' + recurrenceActivityIdStr + '\n';
                }
            } else {
                result += 'NO SINGLE EVENTS FOUND for owner: ' + targetCalendarId + '\n';
            }
            
            return result;
            
        } catch (Exception e) {
            return 'ERROR: ' + e.getMessage() + '\n' + e.getStackTraceString();
        }
    }
    */

    private static Boolean isUserAuthorized() {
        try {
            // Get current user's profile name
            User currentUser = [
                SELECT Profile.Name 
                FROM User 
                WHERE Id = :UserInfo.getUserId()
                LIMIT 1
            ];
            
            String profileName = currentUser.Profile.Name;
            
            // Check if user has authorized profile
            Set<String> authorizedProfiles = new Set<String>{
                'System Administrator',
                'CFSuite Councillor Plus Login User'
            };
            
            return authorizedProfiles.contains(profileName);
            
        } catch (Exception e) {
            System.debug('Error checking user authorization: ' + e.getMessage());
            return false;
        }
    }
}